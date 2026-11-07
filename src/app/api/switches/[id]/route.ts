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
  console.warn(`[switches PUT] id=${id} nextId=${nextId} ringId=${ringId}`);
  // Validate ring membership — but ONLY if both switches have a ringId set.
  // If either switch has no ring, allow the link (user might be setting up
  // the ring topology step by step).
  if (ringId && nextId && nextId !== id) {
    const nextSwitch = await db.switch.findUnique({ where: { id: nextId }, select: { ringId: true, name: true } });
    console.warn(`[switches PUT] next switch: ${nextSwitch?.name} ringId=${nextSwitch?.ringId}`);
    if (nextSwitch && nextSwitch.ringId && nextSwitch.ringId !== ringId) {
      return NextResponse.json({ error: `Next switch "${nextSwitch.name}" is in a different ring. Both switches must be in the same ring.` }, { status: 400 });
    }
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
    ringId, nextSwitchId: nextId,
  };
  if (nextId && nextId !== id) {
    const existing = await db.switch.findFirst({ where: { nextSwitchId: nextId, NOT: { id } } });
    if (existing) {
      console.warn(`[switches PUT] unlinking previous owner of nextId=${nextId}: ${existing.name}`);
      await db.switch.update({ where: { id: existing.id }, data: { nextSwitchId: null } });
      const updated = await db.switch.update({ where: { id }, data: baseData });
      await db.switch.update({ where: { id: existing.id }, data: { nextSwitchId: id } });
      console.warn(`[switches PUT] ✓ saved with relink. nextSwitchId=${updated.nextSwitchId}`);
      return NextResponse.json(updated);
    }
  }
  const updated = await db.switch.update({ where: { id }, data: baseData });
  console.warn(`[switches PUT] ✓ saved. nextSwitchId=${updated.nextSwitchId}`);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  
  // Get the switch we're deleting and its predecessor (the switch pointing to it)
  const target = await db.switch.findUnique({ where: { id }, select: { nextSwitchId: true } });
  const predecessor = await db.switch.findFirst({ where: { nextSwitchId: id } });
  
  // Step 1: Clear ALL references pointing to this switch (nextSwitchId)
  // This prevents foreign key constraint violations
  await db.switch.updateMany({ where: { nextSwitchId: id }, data: { nextSwitchId: null } });
  
  // Step 2: Delete the switch (cascades to ports, metrics, alerts, neighbors)
  await db.switch.delete({ where: { id } });
  
  // Step 3: Relink predecessor → successor to keep ring closed
  // predecessor was pointing to this switch (now null), 
  // this switch was pointing to target.nextSwitchId (successor)
  // So: predecessor.nextSwitchId = target.nextSwitchId
  if (predecessor && target?.nextSwitchId && predecessor.id !== target.nextSwitchId) {
    // Check if the successor is already pointed to by someone else
    const otherPointer = await db.switch.findFirst({
      where: { nextSwitchId: target.nextSwitchId, NOT: { id: predecessor.id } },
    });
    if (!otherPointer) {
      await db.switch.update({
        where: { id: predecessor.id },
        data: { nextSwitchId: target.nextSwitchId },
      });
    }
  }
  
  return NextResponse.json({ ok: true });
}
