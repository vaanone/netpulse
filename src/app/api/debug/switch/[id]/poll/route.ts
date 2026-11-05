import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollSwitch } from "@/lib/snmp";

// GET /api/debug/switch/<id>/poll
// Polls the switch and returns the raw SNMP result with detailed diagnostics.
// Useful for figuring out which OIDs return data and which fail.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sw = await db.switch.findUnique({ where: { id } });
  if (!sw) return NextResponse.json({ error: "Switch not found" }, { status: 404 });
  const start = Date.now();
  const result = await pollSwitch(sw);
  const elapsed = Date.now() - start;

  // Summary — which OIDs returned data?
  const summary: Record<string, any> = {
    switchName: sw.name,
    ipAddress: sw.ipAddress,
    snmpVersion: sw.snmpVersion,
    mode: result.mode,
    reachable: result.reachable,
    error: result.error,
    elapsedMs: elapsed,
    sysDescr: result.sysDescr ? result.sysDescr.slice(0, 100) : null,
    sysName: result.sysName,
    uptimeSeconds: result.uptimeSeconds,
    cpuUsage: result.cpuUsage,
    memoryUsed: result.memoryUsed,
    memoryFree: result.memoryFree,
    memoryTotal: result.memoryUsed != null && result.memoryFree != null
      ? result.memoryUsed + result.memoryFree
      : null,
    memoryUsagePct: result.memoryUsed != null && result.memoryFree != null
      ? (result.memoryUsed / (result.memoryUsed + result.memoryFree)) * 100
      : null,
    power: result.power,
    interfaceCount: result.interfaces.length,
    domReadingCount: Object.keys(result.domReadings).length,
    transceiverCount: result.transceivers.length,
    neighborCount: result.neighbors.length,
  };

  // Show first 5 interfaces as sample
  const sampleInterfaces = result.interfaces.slice(0, 5).map((i: any) => ({
    ifIndex: i.ifIndex,
    ifName: i.ifName,
    ifDescr: i.ifDescr,
    ifAlias: i.ifAlias,
    ifOperStatus: i.ifOperStatus,   // 1=up, 2=down, 3=testing, 4=unknown
    ifAdminStatus: i.ifAdminStatus,
    ifHighSpeed: i.ifHighSpeed,
  }));

  // Show first 3 neighbors as sample
  const sampleNeighbors = result.neighbors.slice(0, 3);

  return NextResponse.json({
    summary,
    sampleInterfaces,
    sampleNeighbors,
  });
}
