import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";

// GET /api/users — list all users (admin only). Never returns password hashes.
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, role: true, createdAt: true },
  });
  return NextResponse.json(users);
}

// POST /api/users — create a new user (admin only).
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { username?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role === "admin" ? "admin" : "user";

  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-32 chars: lowercase letters, digits, . _ or -" },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json({ error: "Username already exists" }, { status: 409 });
  }

  const user = await db.user.create({
    data: { username, passwordHash: hashPassword(password), role },
    select: { id: true, username: true, role: true, createdAt: true },
  });
  return NextResponse.json(user, { status: 201 });
}
