// NETPULSE authentication — password hashing (scrypt) + signed session tokens
// (HMAC-SHA256) stored in an httpOnly cookie.
//
// Two verification paths share the same token format:
//   • src/middleware.ts   — Web Crypto (Edge runtime) for request gating
//   • this file (Node)    — Node crypto for route handlers + password checks
//
// Token shape:  base64url(payloadJson) . base64url(hmacSha256(payloadJson, secret))
// Payload:      { uid, username, role, exp }

import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, NextRequest } from "next/server";
import { db } from "@/lib/db";

export const SESSION_COOKIE_NAME = "np_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days (seconds)

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    // Fallback so dev never hard-crashes, but warn loudly.
    console.warn("SESSION_SECRET not set — using insecure dev fallback.");
    return "np-insecure-dev-fallback";
  }
  return s;
}

export type UserRole = "admin" | "user";
export interface SessionPayload {
  uid: string;
  username: string;
  role: UserRole;
  exp: number; // epoch ms
}
export interface SafeUser {
  id: string;
  username: string;
  role: UserRole;
}

// ---------------------------------------------------------------------------
// Password hashing — scrypt with a per-user salt. Format: scrypt$saltB64$hashB64
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, salt, 64);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session token — HMAC-SHA256 signed JSON. Verifiable in both Node and Edge.
// ---------------------------------------------------------------------------

export function createSessionToken(payload: SessionPayload): string {
  const payloadJson = JSON.stringify(payload);
  const sig = createHmac("sha256", getSecret()).update(payloadJson).digest();
  return `${Buffer.from(payloadJson, "utf8").toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  let payloadJson: string;
  try {
    payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", getSecret()).update(payloadJson).digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (expectedSig.length !== actualSig.length) return null;
  if (!timingSafeEqual(expectedSig, actualSig)) return null;
  try {
    const payload = JSON.parse(payloadJson) as SessionPayload;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// Session retrieval — for route handlers (reads request cookie via next/headers)
// ---------------------------------------------------------------------------

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// Reads cookie directly from a NextRequest (used by middleware-less checks).
export function getSessionFromRequest(req: NextRequest): SessionPayload | null {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await getSession();
  if (!session) return null;
  return { id: session.uid, username: session.username, role: session.role };
}

// Re-validate the session against the DB (so a deleted/demoted user is caught).
// Use this for sensitive operations where the cached token role may be stale.
export async function getCurrentUserFresh(): Promise<SafeUser | null> {
  const session = await getSession();
  if (!session) return null;
  const row = await db.user.findUnique({
    where: { id: session.uid },
    select: { id: true, username: true, role: true },
  });
  if (!row) return null;
  return { id: row.id, username: row.username, role: row.role as UserRole };
}

// Require a logged-in user (any role). Returns the user, or a 401 response.
export async function requireUser(): Promise<SafeUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}

// Require an admin. Returns the user, or a 401 (not logged in) / 403 (not admin).
// Re-checks the DB so a demoted admin is immediately locked out.
export async function requireAdmin(): Promise<SafeUser | NextResponse> {
  const user = await getCurrentUserFresh();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }
  return user;
}
