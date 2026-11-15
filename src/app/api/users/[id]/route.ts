import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH /api/users/[id] — update password and/or role (admin only).
// A self-demotion guard prevents the last admin from locking everyone out.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  let body: { password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const data: { passwordHash?: string; role?: string } = {};

  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    data.passwordHash = hashPassword(body.password);
  }

  if (body.role === "admin" || body.role === "user") {
    // Prevent demoting the last remaining admin.
    if (body.role === "user" && target.role === "admin") {
      const adminCount = await db.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last admin — promote another user first." },
          { status: 400 },
        );
      }
    }
    data.role = body.role;
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, username: true, role: true, createdAt: true },
  });
  return NextResponse.json(updated);
}

// DELETE /api/users/[id] — delete a user (admin only).
// Cannot delete the last admin or yourself.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  // auth is SafeUser here
  const currentUserId = auth.id;

  const { id } = await params;

  if (id === currentUserId) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.role === "admin") {
    const adminCount = await db.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last admin account." },
        { status: 400 },
      );
    }
  }

  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
