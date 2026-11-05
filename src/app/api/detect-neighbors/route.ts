import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollSwitch } from "@/lib/snmp";

// POST /api/detect-neighbors
// Body: { name, ipAddress, snmpVersion, community?, snmpPort?, v3... }
// Returns: { neighbors: [{ deviceId, devicePort, address, matchedSwitchId?, matchedSwitchName? }] }
//
// This endpoint polls a switch that hasn't been added yet (using the
// provided SNMP credentials) and checks its CDP/LLDP neighbors against
// all switches already configured in NETPULSE. This lets the Add Switch
// form auto-fill the "Next Switch in Ring" field.

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
    nextSwitchId: null,
    status: "unknown",
    lastSeen: null,
    pollingMode: "auto",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  try {
    const poll = await pollSwitch(tempSwitch as any);

    // Get all existing switches to match against
    const existingSwitches = await db.switch.findMany({
      select: { id: true, name: true, ipAddress: true, ringId: true },
    });

    // Match each discovered neighbor against existing switches
    const neighbors = (poll.neighbors || []).map((n) => {
      let matchedSwitchId: string | null = null;
      let matchedSwitchName: string | null = null;

      // Match by IP address
      if (n.address) {
        const byIp = existingSwitches.find(s => s.ipAddress === n.address);
        if (byIp) {
          matchedSwitchId = byIp.id;
          matchedSwitchName = byIp.name;
        }
      }
      // Match by hostname
      if (!matchedSwitchId && n.deviceId) {
        const byName = existingSwitches.find(s => s.name.toLowerCase() === n.deviceId!.toLowerCase());
        if (byName) {
          matchedSwitchId = byName.id;
          matchedSwitchName = byName.name;
        }
      }
      // Fuzzy match by hostname suffix
      if (!matchedSwitchId && n.deviceId) {
        const lowerId = n.deviceId.toLowerCase();
        const bySuffix = existingSwitches.find(s =>
          lowerId.startsWith(s.name.toLowerCase() + ".") ||
          lowerId === s.name.toLowerCase()
        );
        if (bySuffix) {
          matchedSwitchId = bySuffix.id;
          matchedSwitchName = bySuffix.name;
        }
      }

      return {
        deviceId: n.deviceId,
        devicePort: n.devicePort,
        address: n.address,
        protocol: n.protocol,
        matchedSwitchId,
        matchedSwitchName,
      };
    });

    return NextResponse.json({
      reachable: poll.reachable,
      mode: poll.mode,
      sysName: poll.sysName,
      neighbors,
    });
  } catch (err: any) {
    return NextResponse.json({
      reachable: false,
      mode: "simulate",
      neighbors: [],
      error: err?.message ?? "Detection failed",
    });
  }
}
