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

  // Show first 10 interfaces as sample (port names + status)
  const sampleInterfaces = result.interfaces.slice(0, 10).map((i: any) => ({
    ifIndex: i.ifIndex,
    ifName: i.ifName,
    ifDescr: i.ifDescr,
    ifAlias: i.ifAlias,
    ifOperStatus: i.ifOperStatus,   // 1=up, 2=down, 3=testing, 4=unknown
    ifAdminStatus: i.ifAdminStatus,
    ifHighSpeed: i.ifHighSpeed,
  }));

  // Show all neighbors
  const sampleNeighbors = result.neighbors.slice(0, 5);

  // Diagnosis — figure out WHY a field is null and suggest a fix
  const diagnosis: string[] = [];
  if (!result.reachable) {
    diagnosis.push("Switch is unreachable — check IP, firewall, SNMP service enabled on switch.");
  }
  if (result.reachable && result.cpuUsage == null) {
    diagnosis.push("CPU: null. Switch does not support cpmCPUTotal5minRev (CISCO-PROCESS-MIB) nor rlCpuUsage (SMB). Try 'show snmp mib' on the switch CLI to list supported OIDs.");
  }
  if (result.reachable && result.memoryUsed == null) {
    diagnosis.push("Memory: null. Switch does not support ciscoMemoryPoolUsed (CISCO-MEMORY-POOL-MIB) nor rlMemoryPoolTotal (SMB).");
  }
  if (result.reachable && result.interfaces.length === 0) {
    diagnosis.push("Interfaces: empty. IF-MIB (1.3.6.1.2.1.2) not accessible — check 'snmp-server view' on switch, or community string read permissions.");
  }
  if (result.reachable && result.interfaces.length > 0 && result.interfaces.every((i: any) => i.ifName.startsWith("if"))) {
    diagnosis.push("ifName returned numbers — ifName OID (1.3.6.1.2.1.31.1.1.1.1) not supported on this switch. Falling back to ifDescr.");
  }

  return NextResponse.json({
    summary,
    sampleInterfaces,
    sampleNeighbors,
    diagnosis,
  });
}
