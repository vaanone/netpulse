import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollSwitchViaSsh } from "@/lib/cli-poll";

// GET /api/debug/switch/<id>/cli-test
// Logs into the switch via SSH or Telnet (whichever is configured), runs all
// the CLI commands, and returns the parsed result with diagnostics.
// Useful for figuring out which CLI commands work on your specific switch.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sw = await db.switch.findUnique({ where: { id } });
  if (!sw) return NextResponse.json({ error: "Switch not found" }, { status: 404 });

  if (!sw.sshEnabled || !sw.sshUsername || !sw.sshPassword) {
    return NextResponse.json({
      error: "CLI fallback is not enabled for this switch.",
      hint: "Open the switch in Edit mode, scroll to 'CLI Fallback', enable it, enter SSH/Telnet credentials.",
    }, { status: 400 });
  }

  const proto = (sw as any).cliProtocol === "telnet" ? "telnet" : "ssh";
  const port = sw.sshPort ?? (proto === "telnet" ? 23 : 22);

  const start = Date.now();
  let result;
  try {
    result = await pollSwitchViaSsh(sw);
  } catch (e: any) {
    return NextResponse.json({
      error: `${proto.toUpperCase()} connection failed: ${e?.message}`,
      proto, port, username: sw.sshUsername, host: sw.ipAddress,
      elapsedMs: Date.now() - start,
    }, { status: 500 });
  }
  const elapsed = Date.now() - start;

  if (!result) {
    return NextResponse.json({ error: "pollSwitchViaSsh returned null" }, { status: 500 });
  }

  return NextResponse.json({
    summary: {
      switchName: sw.name,
      ipAddress: sw.ipAddress,
      proto,
      port,
      username: sw.sshUsername,
      reachable: result.reachable,
      mode: result.mode,
      error: result.error,
      elapsedMs: elapsed,
      sysDescr: result.sysDescr,
      sysName: result.sysName,
      uptimeSeconds: result.uptimeSeconds,
      cpuUsage: result.cpuUsage,
      memoryUsed: result.memoryUsed,
      memoryFree: result.memoryFree,
      memoryTotal: result.memoryUsed != null && result.memoryFree != null
        ? result.memoryUsed + result.memoryFree : null,
      memoryUsagePct: result.memoryUsed != null && result.memoryFree != null
        ? (result.memoryUsed / (result.memoryUsed + result.memoryFree)) * 100 : null,
      power: result.power,
      interfaceCount: result.interfaces.length,
      neighborCount: result.neighbors.length,
    },
    sampleInterfaces: result.interfaces.slice(0, 10).map((i: any) => ({
      ifIndex: i.ifIndex,
      ifName: i.ifName,
      ifDescr: i.ifDescr,
      ifAlias: i.ifAlias,
      ifOperStatus: i.ifOperStatus,
      ifAdminStatus: i.ifAdminStatus,
      ifHighSpeed: i.ifHighSpeed,
      // Convert BigInt counters to strings to avoid JSON serialization errors
      ifSpeed: i.ifSpeed != null ? String(i.ifSpeed) : null,
      ifInOctets: i.ifInOctets != null ? String(i.ifInOctets) : null,
      ifOutOctets: i.ifOutOctets != null ? String(i.ifOutOctets) : null,
      ifInErrors: i.ifInErrors != null ? String(i.ifInErrors) : null,
      ifOutErrors: i.ifOutErrors != null ? String(i.ifOutErrors) : null,
    })),
    sampleNeighbors: result.neighbors.slice(0, 5),
    diagnosis: buildDiagnosis(result, proto),
  });
}

function buildDiagnosis(result: any, proto: string): string[] {
  const d: string[] = [];
  if (!result.reachable) {
    d.push(`${proto.toUpperCase()} connection failed entirely. Check host, port, credentials.`);
    return d;
  }
  if (result.cpuUsage == null) d.push("CPU: null. CLI command 'show processes cpu' didn't parse. Your firmware may use different output format.");
  if (result.memoryUsed == null) d.push("Memory: null. CLI command 'show memory statistics' (or 'show memory') didn't parse. Try running it manually on the switch.");
  if (result.interfaces.length === 0) d.push("Interfaces: empty. CLI commands 'show interfaces status' / 'show interfaces description' didn't return parsed rows. Verify output format on your firmware.");
  if (result.neighbors.length === 0) d.push("Neighbors: 0. Either no CDP/LLDP neighbors are connected, or 'show cdp neighbors' output didn't parse.");
  if (result.sysDescr == null) d.push("sysDescr: null. 'show version' didn't parse. The regex may need updating for your firmware.");
  return d;
}
