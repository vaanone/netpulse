import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pollSwitch } from "@/lib/snmp";

// POST /api/detect-neighbors
// Body: { name, ipAddress, snmpVersion, community?, snmpPort?, v3... }
// Returns: { reachable, neighbors: [{ deviceId, devicePort, address, matchedSwitchId?, matchedSwitchName?, protocol }] }
//
// This endpoint polls a switch (that hasn't been added yet) and checks
// its CDP/LLDP neighbors against all switches already configured in NETPULSE.
// If the switch is unreachable (simulation mode), it returns simulated
// neighbors based on IP subnet proximity.

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
    // Get all existing switches to match against
    const existingSwitches = await db.switch.findMany({
      select: { id: true, name: true, ipAddress: true, ringId: true },
    });

    const poll = await pollSwitch(tempSwitch as any);

    // Match each discovered neighbor against existing switches
    const neighbors = (poll.neighbors || []).map((n) => {
      let matchedSwitchId: string | null = null;
      let matchedSwitchName: string | null = null;

      // 1. Match by IP address (most reliable)
      if (n.address) {
        const byIp = existingSwitches.find(s => s.ipAddress === n.address);
        if (byIp) {
          matchedSwitchId = byIp.id;
          matchedSwitchName = byIp.name;
        }
      }
      // 2. Match by hostname
      if (!matchedSwitchId && n.deviceId) {
        const byName = existingSwitches.find(s => s.name.toLowerCase() === n.deviceId!.toLowerCase());
        if (byName) {
          matchedSwitchId = byName.id;
          matchedSwitchName = byName.name;
        }
      }
      // 3. Fuzzy match by hostname suffix
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

    // In simulation mode: also check ALL existing switches in the same IP subnet
    // This catches switches that the simulator might not have generated as CDP neighbors
    if (!poll.reachable) {
      const ipParts = body.ipAddress.split(".").map(Number);
      if (ipParts.length === 4) {
        const subnet = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
        const sameSubnet = existingSwitches.filter(s => {
          if (s.ipAddress === body.ipAddress) return false; // skip self
          const parts = s.ipAddress.split(".");
          return parts.length === 4 && `${parts[0]}.${parts[1]}.${parts[2]}` === subnet;
        });
        for (const sw of sameSubnet) {
          const alreadyAdded = neighbors.some(n => n.matchedSwitchId === sw.id);
          if (!alreadyAdded) {
            neighbors.push({
              deviceId: sw.name,
              devicePort: "auto-detected",
              address: sw.ipAddress,
              protocol: "cdp",
              matchedSwitchId: sw.id,
              matchedSwitchName: sw.name,
            });
          }
        }
      }
    }

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
