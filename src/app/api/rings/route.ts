import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const rings = await db.ring.findMany({ where: companyId ? { companyId } : undefined, orderBy: { name: "asc" }, include: { company: { select: { id: true, name: true } }, _count: { select: { switches: true } } } });
  return NextResponse.json(rings);
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.companyId) return NextResponse.json({ error: "name and companyId are required" }, { status: 400 });
  const existing = await db.ring.findUnique({ where: { name: body.name } });
  if (existing) return NextResponse.json({ error: `Branch ring "${body.name}" already exists` }, { status: 409 });
  const created = await db.ring.create({ data: { name: body.name, label: body.label ?? null, location: body.location ?? null, companyId: body.companyId }, include: { company: { select: { id: true, name: true } }, _count: { select: { switches: true } } } });
  return NextResponse.json(created, { status: 201 });
}
