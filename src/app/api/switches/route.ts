import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startPolling } from "@/lib/poller";

export async function GET() {
  const switches = await db.switch.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      nextSwitch: { select: { id: true, name: true, ipAddress: true } },
      ring: { select: { id: true, name: true, label: true, location: true, company: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json(switches);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.name || !body.ipAddress) return NextResponse.json({ error: "name and ipAddress are required" }, { status: 400 });
  if (![1, 2, 3].includes(Number(body.snmpVersion))) return NextResponse.json({ error: "snmpVersion must be 1, 2, or 3" }, { status: 400 });
  const existing = await db.switch.findUnique({ where: { name: body.name } });
  if (existing) return NextResponse.json({ error: `Switch "${body.name}" already exists` }, { status: 409 });
  const ringId = body.ringId || null;
  const nextId = body.nextSwitchId || null;
  if (ringId && nextId) {
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
    sshEnabled: Boolean(body.sshEnabled ?? false),
    cliProtocol: body.cliProtocol === "telnet" ? "telnet" : "ssh",
    sshUsername: body.sshUsername ?? null,
    sshPassword: body.sshPassword ?? null,
    sshPort: Number(body.sshPort ?? (body.cliProtocol === "telnet" ? 23 : 22)),
    ringId,
  };
  if (nextId) {
    const existing = await db.switch.findFirst({ where: { nextSwitchId: nextId } });
    if (existing) await db.switch.update({ where: { id: existing.id }, data: { nextSwitchId: null } });
    const created = await db.switch.create({ data: { ...baseData, nextSwitchId: nextId }, include: { ring: { select: { id: true, name: true, label: true, location: true, company: { select: { id: true, name: true } } } } } });
    if (existing) await db.switch.update({ where: { id: existing.id }, data: { nextSwitchId: created.id } });
    startPolling();
    return NextResponse.json(created, { status: 201 });
  }
  const created = await db.switch.create({ data: { ...baseData, nextSwitchId: null }, include: { ring: { select: { id: true, name: true, label: true, location: true, company: { select: { id: true, name: true } } } } } });
  startPolling();
  return NextResponse.json(created, { status: 201 });
}
