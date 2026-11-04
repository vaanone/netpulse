import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() {
  const companies = await db.company.findMany({ orderBy: { name: "asc" }, include: { rings: { orderBy: { name: "asc" }, include: { _count: { select: { switches: true } } } } } });
  return NextResponse.json(companies);
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const existing = await db.company.findUnique({ where: { name: body.name } });
  if (existing) return NextResponse.json({ error: `Company "${body.name}" already exists` }, { status: 409 });
  const created = await db.company.create({ data: { name: body.name, description: body.description ?? null } });
  return NextResponse.json(created, { status: 201 });
}
