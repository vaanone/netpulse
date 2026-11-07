import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollSwitch } from "@/lib/snmp";
import { pollSwitchViaSsh } from "@/lib/cli-poll";

// POST /api/detect-neighbors
// Body: { name, ipAddress, snmpVersion, community?, snmpPort?, v3...,
//         sshEnabled?, cliProtocol?, sshUsername?, sshPassword?, sshPort? }
// Returns: { reachable, neighbors: [{ deviceId, devicePort, address, matchedSwitchId?, matchedSwitchName?, protocol }] }
//
// This endpoint polls a switch (that hasn't been added yet) and checks
// its CDP/LLDP neighbors against all switches already configured in NETPULSE.
// Tries SNMP first, falls back to SSH/Telnet if SNMP returns no neighbors.

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.ipAddress) {
    return NextResponse.json({ error: "IP address is required" }, { status: 400 });
  }

  // Build a temporary SwitchRow for pollSwitch
  const tempSwitch = {
    id: "_temp",
    name: body.name || "temp",
    ipAddress: body.ipAddress,
    location: null,
    snmpVersion: Number(body.snmpVersion || 2),
    community: body.community || (body.snmpVersion === 3 ? null : "public"),
    snmpPort: Number(body.snmpPort || 161),
    v3SecurityLevel: body.v3SecurityLevel || null,
    v3Username: body.v3Username || null,
    v3AuthProtocol: body.v3AuthProtocol || null,
    v3AuthPassword: body.v3AuthPassword || null,
    v3PrivProtocol: body.v3PrivProtocol || null,
    v3PrivPassword: body.v3PrivPassword || null,
    // SSH/Telnet credentials for CLI fallback
    sshEnabled: Boolean(body.sshEnabled ?? false),
    cliProtocol: body.cliProtocol === "telnet" ? "telnet" : "ssh",
    sshUsername: body.sshUsername || null,
    sshPassword: body.sshPassword || null,
    sshPort: Number(body.sshPort ?? (body.cliProtocol === "telnet" ? 23 : 22)),
    nextSwitchId: null,
    status: "unknown",
    lastSeen: null,
    pollingMode: "auto",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  try {
    // Get all existing switches to match against
    const existingSwitches = await db.switch.findMany({
      select: { id: true, name: true, ipAddress: true, ringId: true },
    });

    let poll = await pollSwitch(tempSwitch as any);

    // ─── SSH/Telnet fallback for neighbor detection ───
    // If SNMP returned 0 neighbors AND CLI credentials are provided, try CLI.
    // On Catalyst SMB switches, SNMP may return sysDescr but not CDP neighbors
    // correctly — running 'show cdp neighbors' via SSH/Telnet is more reliable.
    if (
      (poll.neighbors || []).length === 0 &&
      tempSwitch.sshEnabled &&
      tempSwitch.sshUsername &&
      tempSwitch.sshPassword
    ) {
      console.warn(`[detect-neighbors] ${tempSwitch.ipAddress}: SNMP returned 0 neighbors, trying ${tempSwitch.cliProtocol.toUpperCase()} fallback`);
      try {
        const cliResult = await pollSwitchViaSsh(tempSwitch as any);
        if (cliResult && (cliResult.neighbors || []).length > 0) {
          console.warn(`[detect-neighbors] ${tempSwitch.ipAddress}: ${tempSwitch.cliProtocol.toUpperCase()} found ${cliResult.neighbors.length} neighbors`);
          // Use the CLI result — preserve sysDescr from SNMP if available
          if (!cliResult.sysDescr && poll.sysDescr) cliResult.sysDescr = poll.sysDescr;
          if (!cliResult.sysName && poll.sysName) cliResult.sysName = poll.sysName;
          poll = cliResult;
        } else {
          console.warn(`[detect-neighbors] ${tempSwitch.ipAddress}: ${tempSwitch.cliProtocol.toUpperCase()} returned no neighbors`);
        }
      } catch (e: any) {
        console.warn(`[detect-neighbors] ${tempSwitch.ipAddress}: ${tempSwitch.cliProtocol.toUpperCase()} fallback failed: ${e?.message}`);
      }
    }

    // Match each discovered neighbor against existing switches
    const neighbors = (poll.neighbors || []).map((n) => {
      let matchedSwitchId: string | null = null;
      let matchedSwitchName: string | null = null;
      let matchedBy: string | null = null;

      // 1. Match by IP address (most reliable)
      if (n.address) {
        const byIp = existingSwitches.find(s => s.ipAddress === n.address);
        if (byIp) {
          matchedSwitchId = byIp.id;
          matchedSwitchName = byIp.name;
          matchedBy = "ip";
        }
      }
      // 2. Match by hostname (exact, case-insensitive)
      if (!matchedSwitchId && n.deviceId) {
        const byName = existingSwitches.find(s => s.name.toLowerCase() === n.deviceId!.toLowerCase());
        if (byName) {
          matchedSwitchId = byName.id;
          matchedSwitchName = byName.name;
          matchedBy = "name-exact";
        }
      }
      // 3. Fuzzy match by hostname suffix (handles FQDNs like "switch2.example.com" → "switch2")
      if (!matchedSwitchId && n.deviceId) {
        const lowerId = n.deviceId.toLowerCase();
        const bySuffix = existingSwitches.find(s =>
          lowerId.startsWith(s.name.toLowerCase() + ".") ||
          lowerId === s.name.toLowerCase()
        );
        if (bySuffix) {
          matchedSwitchId = bySuffix.id;
          matchedSwitchName = bySuffix.name;
          matchedBy = "name-suffix";
        }
      }
      // 4. Fuzzy match: switch name appears anywhere in deviceId
      if (!matchedSwitchId && n.deviceId) {
        const lowerId = n.deviceId.toLowerCase();
        const byContains = existingSwitches.find(s =>
          lowerId.includes(s.name.toLowerCase()) && s.name.length >= 3
        );
        if (byContains) {
          matchedSwitchId = byContains.id;
          matchedSwitchName = byContains.name;
          matchedBy = "name-substring";
        }
      }
      // 5. Match by switch IP appearing in deviceId (some switches report "switch-192.168.10.201")
      if (!matchedSwitchId && n.deviceId) {
        const byIpInDeviceId = existingSwitches.find(s =>
          s.ipAddress && n.deviceId!.includes(s.ipAddress)
        );
        if (byIpInDeviceId) {
          matchedSwitchId = byIpInDeviceId.id;
          matchedSwitchName = byIpInDeviceId.name;
          matchedBy = "ip-in-deviceid";
        }
      }

      return {
        deviceId: n.deviceId,
        devicePort: n.devicePort,
        address: n.address,
        protocol: n.protocol,
        matchedSwitchId,
        matchedSwitchName,
        matchedBy,
      };
    });

    return NextResponse.json({
      reachable: poll.reachable || (poll.neighbors || []).length > 0,
      mode: poll.mode,
      sysName: poll.sysName,
      neighbors,
      method: (poll.neighbors || []).length > 0 && poll.reachable ? "snmp" : "cli",
    });
  } catch (err: any) {
    return NextResponse.json({
      reachable: false,
      mode: "simulate",
      neighbors: [],
      error: err?.message ?? "Detection failed",
    }, { status: 500 });
  }
}
