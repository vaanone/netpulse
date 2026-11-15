// NETPULSE middleware — gates every request behind a valid session cookie.
//
// Public paths: /login and /api/auth/* (login + logout must be reachable
// without a session). Everything else requires a signed session token.
//
// Token verification uses the Web Crypto API (Edge runtime) — the SAME
// HMAC-SHA256 over the SAME payload as src/lib/auth.ts (Node crypto), so a
// token issued by the Node login route verifies here and vice-versa.
//
// Role enforcement (admin vs view-only) is NOT done here — middleware only
// checks "is the user logged in?". Write route handlers call requireAdmin()
// to enforce the admin role against the live DB.

import { NextRequest, NextResponse } from "next/server";

// Keep this in sync with SESSION_COOKIE_NAME in src/lib/auth.ts. Duplicated
// here (not imported) because auth.ts pulls in Node-only modules (Prisma,
// next/headers, node:crypto) that cannot run in the Edge middleware runtime.
const SESSION_COOKIE_NAME = "np_session";

const enc = new TextEncoder();

function atobUrl(input: string): string {
  // base64url → base64 → string
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return atob(b64 + pad);
}

function b64urlToBytes(input: string): Uint8Array {
  const bin = atobUrl(input);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyToken(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  // Match the fallback in src/lib/auth.ts so dev works without SESSION_SECRET.
  const secret = process.env.SESSION_SECRET ?? "np-insecure-dev-fallback";

  // Decode payload to check expiry before bothering with crypto.
  let payloadJson: string;
  try {
    payloadJson = atobUrl(payloadB64);
  } catch {
    return false;
  }
  try {
    const data = JSON.parse(payloadJson);
    if (data?.exp && Date.now() > data.exp) return false;
  } catch {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = b64urlToBytes(sigB64);
    return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadJson));
  } catch {
    return false;
  }
}

function isPublic(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const ok = token ? await verifyToken(token) : false;

  if (!ok) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on everything except Next internals and static files with extensions.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
