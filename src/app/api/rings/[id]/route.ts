import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
interface RouteParams { params: Promise<{ id: string }>; }
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json();
  const updated = await db.ring.update({ where: { id }, data: { name: body.name, label: body.label ?? null, location: body.location ?? null } });
  return NextResponse.json(updated);
}
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await db.ring.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
