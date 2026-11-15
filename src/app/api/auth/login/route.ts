import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createSessionToken, setSessionCookie, SESSION_TOKEN_MAX_AGE_MS } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { username } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const token = createSessionToken({
    uid: user.id,
    username: user.username,
    role: user.role as "admin" | "user",
    exp: Date.now() + SESSION_TOKEN_MAX_AGE_MS,
  });

  const res = NextResponse.json({
    id: user.id,
    username: user.username,
    role: user.role,
  });
  setSessionCookie(res, token);
  return res;
}
