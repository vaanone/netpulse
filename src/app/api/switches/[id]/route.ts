import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sw = await db.switch.findUnique({
    where: { id },
    include: { nextSwitch: { select: { id: true, name: true, ipAddress: true, snmpVersion: true } }, prevSwitches: { select: { id: true, name: true, ipAddress: true } }, ports: { orderBy: { ifIndex: "asc" } } },
  });
  if (!sw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(sw);
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json();
  const nextId = body.nextSwitchId || null;
  const ringId = body.ringId || null;
  if (ringId && nextId && nextId !== id) {
    const nextSwitch = await db.switch.findUnique({ where: { id: nextId }, select: { ringId: true } });
    if (nextSwitch && nextSwitch.ringId !== ringId) return NextResponse.json({ error: "Next switch in ring must belong to the same branch ring." }, { status: 400 });
  }
  const baseData = {
    name: body.name, ipAddress: body.ipAddress, location: body.location ?? null,
    snmpVersion: Number(body.snmpVersion),
    community: body.community ?? (body.snmpVersion === 3 ? null : "public"),
    snmpPort: Number(body.snmpPort ?? 161),
    v3SecurityLevel: body.v3SecurityLevel ?? null, v3Username: body.v3Username ?? null,
    v3AuthProtocol: body.v3AuthProtocol ?? null, v3AuthPassword: body.v3AuthPassword ?? null,
    v3PrivProtocol: body.v3PrivProtocol ?? null, v3PrivPassword: body.v3PrivPassword ?? null,
    ringId, nextSwitchId: nextId,
  };
  if (nextId && nextId !== id) {
    const existing = await db.switch.findFirst({ where: { nextSwitchId: nextId, NOT: { id } } });
    if (existing) {
      await db.switch.update({ where: { id: existing.id }, data: { nextSwitchId: null } });
      const updated = await db.switch.update({ where: { id }, data: baseData });
      await db.switch.update({ where: { id: existing.id }, data: { nextSwitchId: id } });
      return NextResponse.json(updated);
    }
  }
  const updated = await db.switch.update({ where: { id }, data: baseData });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const target = await db.switch.findUnique({ where: { id }, select: { nextSwitchId: true } });
  const predecessor = await db.switch.findFirst({ where: { nextSwitchId: id } });
  await db.switch.updateMany({ where: { nextSwitchId: id }, data: { nextSwitchId: null } });
  await db.switch.delete({ where: { id } });
  if (predecessor && target?.nextSwitchId && predecessor.id !== target.nextSwitchId) {
    const otherPointer = await db.switch.findFirst({ where: { nextSwitchId: target.nextSwitchId, NOT: { id: predecessor.id } } });
    if (!otherPointer) await db.switch.update({ where: { id: predecessor.id }, data: { nextSwitchId: target.nextSwitchId } });
  }
  return NextResponse.json({ ok: true });
}
