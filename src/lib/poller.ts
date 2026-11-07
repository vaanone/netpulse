/**
 * Polling engine — polls every switch at a fixed interval, computes traffic
 * deltas, auto-detects ring ports via CDP/LLDP, generates alerts, and caches
 * the latest snapshot for /api/metrics.
 */

import { db } from "@/lib/db";
import { pollSwitch, simulateSwitch, type PollResult, type PowerSummary, type PowerSupply } from "@/lib/snmp";
import { pollSwitchViaSsh } from "@/lib/cli-poll";

export interface PortSnapshot {
  switchId: string; switchName: string; switchIp: string; switchStatus: string;
  mode: "snmp" | "simulate" | "boot"; error?: string;
  portId: string | null; ifIndex: number; ifName: string; ifDescr: string; ifAlias?: string;
  ifSpeed: bigint | null; ifHighSpeed: number | null; ifOperStatus: number | null;
  isRingPort: boolean; remoteSwitchId?: string | null; remoteSwitchName?: string | null;
  txPower: number | null; rxPower: number | null; temperature: number | null; voltage: number | null; biasCurrent: number | null;
  txWarnLow: number | null; txWarnHigh: number | null; txAlarmLow: number | null; txAlarmHigh: number | null;
  rxWarnLow: number | null; rxWarnHigh: number | null; rxAlarmLow: number | null; rxAlarmHigh: number | null;
  opticalMargin: number | null;
  transceiverType?: string; partNumber?: string; serialNumber?: string;
  inOctets: bigint | null; outOctets: bigint | null; inErrors: bigint | null; outErrors: bigint | null;
  inBps: number | null; outBps: number | null; inMbps: number | null; outMbps: number | null;
  utilization: number | null; totalErrors: number; lastPolledAt: Date | null;
}

export interface NeighborSnapshot {
  localIfIndex: number; localIfName: string | null; deviceId: string; devicePort: string;
  address: string | null; platform: string | null; protocol: "cdp" | "lldp";
  matchedSwitchId: string | null; matchedSwitchName: string | null; matchedSwitchIp: string | null;
}

export interface SwitchSnapshot {
  switchId: string; name: string; ipAddress: string; location?: string | null; snmpVersion: number;
  ringId: string | null; ringName: string | null; ringLabel: string | null; companyName: string | null;
  nextSwitchId: string | null; nextSwitchName: string | null;
  prevSwitchId: string | null; prevSwitchName: string | null;
  status: "up" | "down" | "unreachable" | "unknown"; mode: "snmp" | "simulate" | "boot"; error?: string;
  sysName?: string | null; sysDescr?: string | null; uptimeSeconds?: number | null;
  cpuUsage?: number | null; memoryUsed?: number | null; memoryFree?: number | null;
  memoryTotal?: number | null; memoryUsage?: number | null; lastSeen?: Date | null;
  power?: PowerSummary | null;
  ports: PortSnapshot[]; neighbors: NeighborSnapshot[];
  ringPortAutoDetected: boolean;
  suggestedNextSwitchId: string | null; suggestedNextSwitchName: string | null; suggestedNextSwitchReason: string | null;
  ringPort?: PortSnapshot | null; ringInMbps?: number | null; ringOutMbps?: number | null; ringUtilization?: number | null;
  portsUp: number; portsDown: number; portsAlarm: number; portsWarning: number;
}

export interface RingLinkSnapshot {
  id: string; fromSwitchId: string; fromSwitchName: string; fromPortName: string;
  toSwitchId: string; toSwitchName: string; toPortName: string;
  status: string; inMbps: number; outMbps: number; utilization: number;
  rxPowerA: number | null; rxPowerB: number | null; txPowerA: number | null; txPowerB: number | null;
  health: "ok" | "warning" | "critical";
}

export interface Snapshot { switches: SwitchSnapshot[]; links: RingLinkSnapshot[]; polledAt: Date; }

const PREV_COUNTERS = new Map<string, { ts: number; in: bigint; out: bigint }>();
let CURRENT: Snapshot = { switches: [], links: [], polledAt: new Date(0) };
let POLLING = false;
let TIMER: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 30_000;

// Cache SSH/CLI results — only re-run SSH every 2 minutes, not every 30 seconds.
// SSH sessions take ~70 seconds per switch, so running every 30s blocks the dashboard.
// Between SSH polls, we use cached SSH data + fresh SNMP data (which is fast).
const SSH_CACHE = new Map<string, { result: PollResult; ts: number }>();
const SSH_CACHE_TTL_MS = 120_000;  // 2 minutes — re-run SSH every 4th poll cycle

export async function runPollCycle(): Promise<Snapshot> {
  if (POLLING) return CURRENT;
  POLLING = true;
  try {
    const switches = await db.switch.findMany({
      orderBy: { createdAt: "asc" },
      include: { ring: { select: { id: true, name: true, label: true, location: true, company: { select: { id: true, name: true } } } } },
    });
    const now = Date.now();
    const snapshots: SwitchSnapshot[] = [];
    const results = await Promise.allSettled(switches.map(async (sw) => {
      try {
        let poll = await pollSwitch(sw);
        // ─── SSH/Telnet CLI fallback (cached) ───
        // SSH sessions take ~70 seconds per switch. Running every 30s would block
        // the dashboard. Instead, cache SSH results for 2 minutes.
        // On the first poll, SSH runs (takes 70s). On subsequent polls within 2 min,
        // we use the cached SSH result + fresh SNMP data (which takes ~5s).
        // This makes the dashboard load in ~10 seconds instead of 5 minutes.
        if (sw.sshEnabled && sw.sshUsername && sw.sshPassword) {
          const proto = (sw as any).cliProtocol === "telnet" ? "telnet" : "ssh";
          const port = sw.sshPort ?? (proto === "telnet" ? 23 : 22);
          // Check cache — skip SSH if we have a recent result
          const cached = SSH_CACHE.get(sw.id);
          const cacheAge = cached ? now - cached.ts : Infinity;
          if (cached && cacheAge < SSH_CACHE_TTL_MS) {
            // Use cached SSH result + fresh SNMP data
            console.warn(`[poller] ${sw.name}: using cached SSH data (${Math.round(cacheAge / 1000)}s old)`);
            const sshResult = cached.result;
            // Merge cached SSH with fresh SNMP (for traffic counters)
            if (!sshResult.sysDescr && poll.sysDescr) sshResult.sysDescr = poll.sysDescr;
            if (!sshResult.sysName && poll.sysName) sshResult.sysName = poll.sysName;
            if (!sshResult.uptimeSeconds && poll.uptimeSeconds) sshResult.uptimeSeconds = poll.uptimeSeconds;
            // Merge SNMP counters into cached SSH interfaces
            // IMPORTANT: ALWAYS overwrite traffic counters (not just when null)
            // because inBps/outBps requires the counter value to change between
            // polls. If we only set when null, the counter stays frozen at the
            // value from the first SSH poll, and delta = 0 → inBps = 0.
            if (sshResult.interfaces.length > 0 && poll.interfaces.length > 0) {
              const snmpByIfName = new Map<string, any>();
              for (const iface of poll.interfaces) {
                if (iface.ifName) snmpByIfName.set(iface.ifName.toLowerCase(), iface);
              }
              for (const sshIface of sshResult.interfaces) {
                const snmpIface = snmpByIfName.get((sshIface.ifName || "").toLowerCase());
                if (snmpIface) {
                  // Always overwrite with fresh SNMP counters
                  if (snmpIface.ifHCInOctets != null) {
                    sshIface.ifInOctets = snmpIface.ifHCInOctets;
                    sshIface.ifHCInOctets = snmpIface.ifHCInOctets;
                  }
                  if (snmpIface.ifHCOutOctets != null) {
                    sshIface.ifOutOctets = snmpIface.ifHCOutOctets;
                    sshIface.ifHCOutOctets = snmpIface.ifHCOutOctets;
                  }
                  // Also update errors
                  if (snmpIface.ifInErrors != null) sshIface.ifInErrors = snmpIface.ifInErrors;
                  if (snmpIface.ifOutErrors != null) sshIface.ifOutErrors = snmpIface.ifOutErrors;
                }
              }
            }
            sshResult.reachable = true;
            poll = sshResult;
          } else {
            // Cache expired or no cache — run fresh SSH poll
            console.warn(`[poller] ${sw.name}: running CLI poll (${proto.toUpperCase()} ${sw.sshUsername}@${sw.ipAddress}:${port}) — cache ${cacheAge === Infinity ? 'empty' : Math.round(cacheAge / 1000) + 's old'}`);
            try {
              const sshResult = await pollSwitchViaSsh(sw);
              if (sshResult) {
                const sshHasBetterData =
                  sshResult.interfaces.length > 0 ||
                  Object.keys(sshResult.domReadings || {}).length > 0 ||
                  sshResult.neighbors.length > 0 ||
                  !poll.reachable;
                if (sshHasBetterData) {
                  if (!sshResult.sysDescr && poll.sysDescr) sshResult.sysDescr = poll.sysDescr;
                  if (!sshResult.sysName && poll.sysName) sshResult.sysName = poll.sysName;
                  if (!sshResult.uptimeSeconds && poll.uptimeSeconds) sshResult.uptimeSeconds = poll.uptimeSeconds;
                  if (sshResult.interfaces.length > 0 && poll.interfaces.length > 0) {
                    const snmpByIfName = new Map<string, any>();
                    for (const iface of poll.interfaces) {
                      if (iface.ifName) snmpByIfName.set(iface.ifName.toLowerCase(), iface);
                    }
                    for (const sshIface of sshResult.interfaces) {
                      const snmpIface = snmpByIfName.get((sshIface.ifName || "").toLowerCase());
                      if (snmpIface) {
                        if (sshIface.ifInOctets == null && snmpIface.ifHCInOctets != null) sshIface.ifInOctets = snmpIface.ifHCInOctets;
                        if (sshIface.ifOutOctets == null && snmpIface.ifHCOutOctets != null) sshIface.ifOutOctets = snmpIface.ifHCOutOctets;
                        if (sshIface.ifHCInOctets == null && snmpIface.ifHCInOctets != null) sshIface.ifHCInOctets = snmpIface.ifHCInOctets;
                        if (sshIface.ifHCOutOctets == null && snmpIface.ifHCOutOctets != null) sshIface.ifHCOutOctets = snmpIface.ifHCOutOctets;
                      }
                    }
                  }
                  sshResult.reachable = true;
                  sshResult.error = `Data via ${proto.toUpperCase()} CLI. ${sshResult.error ?? ""}`;
                  poll = sshResult;
                  // Cache the result — deep copy interfaces so modifications
                  // in subsequent polls don't corrupt the cache
                  SSH_CACHE.set(sw.id, {
                    result: { ...sshResult, interfaces: sshResult.interfaces.map((i: any) => ({ ...i })) },
                    ts: now
                  });
                  console.warn(`[poller] ${sw.name}: ${proto.toUpperCase()} poll succeeded — interfaces=${poll.interfaces.length} neighbors=${poll.neighbors.length} dom=${Object.keys(poll.domReadings).length} uptime=${poll.uptimeSeconds}s (cached for ${SSH_CACHE_TTL_MS / 1000}s)`);
                } else {
                  console.warn(`[poller] ${sw.name}: ${proto.toUpperCase()} returned no useful data, keeping SNMP result`);
                }
              }
            } catch (e: any) {
              console.warn(`[poller] ${sw.name}: ${proto.toUpperCase()} poll failed: ${e?.message}`);
              if (poll.error) poll.error += `; ${proto.toUpperCase()} failed: ${e?.message}`;
            }
          }
        }
        return { sw, poll };
      }
      catch (e: any) { return { sw, poll: simulateSwitch(sw, e?.message ?? "unknown error") }; }
    }));
    const switchById = new Map(switches.map((s) => [s.id, s]));
    const prevSwitchOf = (id: string): { id: string; name: string; ipAddress: string } | null => {
      for (const s of switches) { if (s.nextSwitchId === id) return { id: s.id, name: s.name, ipAddress: s.ipAddress }; }
      return null;
    };

    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      const { sw, poll } = res.value;
      const portsSnap: PortSnapshot[] = [];
      const domByIfIndex = new Map<number, any>();
      for (const [k, v] of Object.entries(poll.domReadings)) domByIfIndex.set(Number(k), v);
      const thByIfIndex = new Map<number, any>();
      for (const [k, v] of Object.entries(poll.thresholds)) thByIfIndex.set(Number(k), v);
      const ifNameByIfIndex = new Map<number, string>();
      for (const iface of poll.interfaces) ifNameByIfIndex.set(iface.ifIndex, iface.ifName);

      const neighborSnap: NeighborSnapshot[] = (poll.neighbors ?? []).map((n) => {
        let matchedId: string | null = null, matchedName: string | null = null, matchedIp: string | null = null;
        const otherSwitches = switches.filter((s) => s.id !== sw.id);
        if (n.address) { const byIp = otherSwitches.find((s) => s.ipAddress === n.address); if (byIp) { matchedId = byIp.id; matchedName = byIp.name; matchedIp = byIp.ipAddress; } }
        if (!matchedId && n.deviceId) { const byName = otherSwitches.find((s) => s.name.toLowerCase() === n.deviceId.toLowerCase()); if (byName) { matchedId = byName.id; matchedName = byName.name; matchedIp = byName.ipAddress; } }
        if (!matchedId && n.deviceId) { const lowerId = n.deviceId.toLowerCase(); const bySuffix = otherSwitches.find((s) => lowerId.startsWith(s.name.toLowerCase() + ".") || lowerId === s.name.toLowerCase()); if (bySuffix) { matchedId = bySuffix.id; matchedName = bySuffix.name; matchedIp = bySuffix.ipAddress; } }
        // For SSH-discovered neighbors, localIfIndex is 0 (we don't know the real ifIndex).
        // Try to find the matching interface by name (e.g. "gi25" → ifIndex 25)
        let resolvedIfIndex = n.localIfIndex;
        let resolvedIfName = ifNameByIfIndex.get(n.localIfIndex) ?? null;
        if ((!resolvedIfName || resolvedIfIndex === 0) && (n as any).localIfName) {
          // Try to find an interface whose name matches localIfName
          const ifaceByName = poll.interfaces.find((i) =>
            i.ifName && i.ifName.toLowerCase() === String((n as any).localIfName).toLowerCase()
          );
          if (ifaceByName) {
            resolvedIfIndex = ifaceByName.ifIndex;
            resolvedIfName = ifaceByName.ifName;
          } else {
            // Even if we can't resolve the ifIndex, keep the name for display
            resolvedIfName = (n as any).localIfName;
          }
        }
        return {
          localIfIndex: resolvedIfIndex,
          localIfName: resolvedIfName,
          deviceId: n.deviceId,
          devicePort: n.devicePort,
          address: n.address,
          platform: n.platform,
          protocol: n.protocol,
          matchedSwitchId: matchedId,
          matchedSwitchName: matchedName,
          matchedSwitchIp: matchedIp,
        };
      });

      const remoteSwitch = sw.nextSwitchId ? switchById.get(sw.nextSwitchId) ?? null : null;
      let ringPortIfIndex: number | null = poll.ringPortIfIndex;
      let ringPortAutoDetected = false;
      let suggestedNextSwitchId: string | null = null, suggestedNextSwitchName: string | null = null, suggestedNextSwitchReason: string | null = null;

      // NOTE: When the switch is unreachable (mode === "simulate"), we do NOT
      // invent CDP/LLDP neighbors anymore. Only real neighbors reported by the
      // switch via SNMP are shown. Auto-detection of the ring port will only
      // succeed once SNMP actually connects.
      if (sw.nextSwitchId) {
        const matchedToNext = neighborSnap.find((n) => n.matchedSwitchId === sw.nextSwitchId);
        if (matchedToNext) { ringPortIfIndex = matchedToNext.localIfIndex; ringPortAutoDetected = true; }
      } else {
        // No next switch configured — auto-suggest ONLY from directly connected
        // CDP/LLDP neighbors. These are switches that see this switch as a neighbor
        // OR that this switch sees as a neighbor via CDP.
        // We must NOT suggest a switch that's 2+ hops away.
        const matchedNeighbors = neighborSnap.filter((n) => n.matchedSwitchId !== null);
        if (matchedNeighbors.length > 0) {
          // Only suggest switches in the SAME ring (directly connected)
          const sameRingMatched = matchedNeighbors.filter((n) => {
            const matchedSw = switchById.get(n.matchedSwitchId!);
            return matchedSw && matchedSw.ringId === sw.ringId;
          });
          if (sameRingMatched.length > 0) {
            // Pick the first same-ring matched neighbor
            const best = sameRingMatched[0];
            if (best && best.matchedSwitchId) {
              suggestedNextSwitchId = best.matchedSwitchId;
              const sug = switchById.get(best.matchedSwitchId);
              suggestedNextSwitchName = sug?.name ?? null;
              suggestedNextSwitchReason = `CDP/LLDP neighbor on port ${best.localIfName ?? best.localIfIndex} (${best.deviceId}) matches configured switch "${sug?.name ?? "?"}" at ${best.matchedSwitchIp}`;
              ringPortIfIndex = best.localIfIndex;
              ringPortAutoDetected = true;
            }
          }
          // If no same-ring match, do NOT suggest a cross-ring switch
          // (that would create a wrong ring topology)
        }
      }

      for (const iface of poll.interfaces) {
        const nameLower = iface.ifName.toLowerCase();
        if (!nameLower.startsWith("gi") && !nameLower.startsWith("te") && !nameLower.startsWith("tw") && !nameLower.startsWith("hu") && !nameLower.startsWith("fo")) continue;
        const dom = domByIfIndex.get(iface.ifIndex);
        const th = thByIfIndex.get(iface.ifIndex);
        const isRingPort = ringPortIfIndex === iface.ifIndex;
        const key = `${sw.id}:${iface.ifIndex}`;
        const prev = PREV_COUNTERS.get(key);
        const inOctets = iface.ifHCInOctets ?? iface.ifInOctets;
        const outOctets = iface.ifHCOutOctets ?? iface.ifOutOctets;
        let inBps: number | null = null, outBps: number | null = null;
        if (prev && inOctets !== null && outOctets !== null && now > prev.ts) {
          const dt = (now - prev.ts) / 1000;
          const din = Number(inOctets - prev.in), dout = Number(outOctets - prev.out);
          if (din >= 0 && dout >= 0 && dt > 0) { inBps = (din * 8) / dt; outBps = (dout * 8) / dt; }
        }
        if (inOctets !== null && outOctets !== null) PREV_COUNTERS.set(key, { ts: now, in: inOctets, out: outOctets });
        const linkSpeed = iface.ifHighSpeed ? iface.ifHighSpeed * 1_000_000 : iface.ifSpeed ? Number(iface.ifSpeed) : null;
        const utilization = inBps !== null && linkSpeed && linkSpeed > 0 ? (inBps / linkSpeed) * 100 : null;
        let opticalMargin: number | null = null;
        if (dom?.rxPower != null && th?.rxAlarmLow != null) opticalMargin = dom.rxPower - th.rxAlarmLow;
        const totalErrors = Number(iface.ifInErrors ?? 0n) + Number(iface.ifOutErrors ?? 0n);
        const transceiver = poll.transceivers.find((t) => t.ifIndex === iface.ifIndex);
        portsSnap.push({
          switchId: sw.id, switchName: sw.name, switchIp: sw.ipAddress,
          switchStatus: poll.reachable || poll.mode === "simulate" ? "up" : "unreachable",
          mode: poll.mode, error: poll.error, portId: null, ifIndex: iface.ifIndex, ifName: iface.ifName,
          ifDescr: iface.ifDescr, ifAlias: iface.ifAlias, ifSpeed: iface.ifSpeed, ifHighSpeed: iface.ifHighSpeed,
          ifOperStatus: iface.ifOperStatus, isRingPort, remoteSwitchId: isRingPort ? remoteSwitch?.id ?? null : null,
          remoteSwitchName: isRingPort ? remoteSwitch?.name ?? null : null,
          txPower: dom?.txPower ?? null, rxPower: dom?.rxPower ?? null, temperature: dom?.temperature ?? null,
          voltage: dom?.voltage ?? null, biasCurrent: dom?.biasCurrent ?? null,
          txWarnLow: th?.txWarnLow ?? null, txWarnHigh: th?.txWarnHigh ?? null, txAlarmLow: th?.txAlarmLow ?? null, txAlarmHigh: th?.txAlarmHigh ?? null,
          rxWarnLow: th?.rxWarnLow ?? null, rxWarnHigh: th?.rxWarnHigh ?? null, rxAlarmLow: th?.rxAlarmLow ?? null, rxAlarmHigh: th?.rxAlarmHigh ?? null,
          opticalMargin, transceiverType: transceiver?.descr, partNumber: transceiver?.modelName, serialNumber: transceiver?.serialNum,
          inOctets, outOctets, inErrors: iface.ifInErrors, outErrors: iface.ifOutErrors,
          inBps, outBps, inMbps: inBps !== null ? inBps / 1_000_000 : null, outMbps: outBps !== null ? outBps / 1_000_000 : null,
          utilization, totalErrors, lastPolledAt: poll.polledAt,
        });
      }

      persistSwitchSnapshot(sw.id, poll, portsSnap, neighborSnap).catch(() => {});
      const ringPort = portsSnap.find((p) => p.isRingPort) ?? null;
      const portsUp = portsSnap.filter((p) => p.ifOperStatus === 1).length;
      const portsDown = portsSnap.filter((p) => p.ifOperStatus === 2).length;
      const portsAlarm = portsSnap.filter((p) => (p.rxPower != null && p.rxAlarmLow != null && p.rxPower <= p.rxAlarmLow) || p.totalErrors > 0).length;
      const portsWarning = portsSnap.filter((p) => p.opticalMargin !== null && p.opticalMargin < 3 && p.opticalMargin >= 0).length;
      const memoryTotal = poll.memoryUsed != null && poll.memoryFree != null ? poll.memoryUsed + poll.memoryFree : null;
      const memoryUsage = memoryTotal != null && poll.memoryUsed != null ? (poll.memoryUsed / memoryTotal) * 100 : null;
      snapshots.push({
        switchId: sw.id, name: sw.name, ipAddress: sw.ipAddress, location: sw.location, snmpVersion: sw.snmpVersion,
        ringId: sw.ring?.id ?? null, ringName: sw.ring?.name ?? sw.ring?.label ?? null, ringLabel: sw.ring?.label ?? null,
        companyName: sw.ring?.company?.name ?? null, nextSwitchId: sw.nextSwitchId ?? null, nextSwitchName: remoteSwitch?.name ?? null,
        prevSwitchId: prevSwitchOf(sw.id)?.id ?? null, prevSwitchName: prevSwitchOf(sw.id)?.name ?? null, status: poll.reachable ? "up" : "unreachable",
        mode: poll.mode, error: poll.error, sysName: poll.sysName, sysDescr: poll.sysDescr, uptimeSeconds: poll.uptimeSeconds,
        cpuUsage: poll.cpuUsage, memoryUsed: poll.memoryUsed, memoryFree: poll.memoryFree, memoryTotal, memoryUsage,
        power: poll.power ?? null,
        lastSeen: poll.reachable ? new Date() : null, ports: portsSnap, neighbors: neighborSnap,
        ringPortAutoDetected, suggestedNextSwitchId, suggestedNextSwitchName, suggestedNextSwitchReason,
        ringPort, ringInMbps: ringPort?.inMbps ?? null, ringOutMbps: ringPort?.outMbps ?? null, ringUtilization: ringPort?.utilization ?? null,
        portsUp, portsDown, portsAlarm, portsWarning,
      });
    }

    const links: RingLinkSnapshot[] = [];
    for (const sw of snapshots) {
      if (!sw.nextSwitchId) continue;
      const next = snapshots.find((s) => s.switchId === sw.nextSwitchId);
      if (!next) continue;
      const fromPort = sw.ringPort, toPort = next.ringPort;
      const inMbps = fromPort?.inMbps ?? 0, outMbps = fromPort?.outMbps ?? 0, utilization = fromPort?.utilization ?? 0;
      const rxPowerA = fromPort?.rxPower ?? null, rxPowerB = toPort?.rxPower ?? null, txPowerA = fromPort?.txPower ?? null, txPowerB = toPort?.txPower ?? null;
      let health: "ok" | "warning" | "critical" = "ok";
      // Determine link status based on what we actually know:
      // 1. If we have ringPort data on both ends AND either is DOWN → critical
      // 2. If we have ringPort data AND Rx power is below alarm threshold → critical
      // 3. If we have NO ringPort data (CDP not yet detected) — fall back to switch status:
      //    if both switches are 'up', the link is 'up' (assume connected)
      //    if either switch is unreachable, the link is 'down'
      // This prevents the link from showing as 'down' when SNMP/SSH returns ports
      // but CDP-based ringPort detection hasn't completed yet.
      if (fromPort && toPort) {
        // We have ring port data on both ends — check normally
        if (fromPort.ifOperStatus !== 1 || toPort.ifOperStatus !== 1) health = "critical";
        else if (rxPowerA != null && fromPort.rxAlarmLow != null && rxPowerA <= fromPort.rxAlarmLow) health = "critical";
        else if (rxPowerB != null && toPort.rxAlarmLow != null && rxPowerB <= toPort.rxAlarmLow) health = "critical";
        else if ((fromPort.opticalMargin ?? 99) < 3 || (toPort.opticalMargin ?? 99) < 3) health = "warning";
      } else {
        // No ring port data — base link status on switch reachability
        // (SNMP may be working but CDP neighbor not yet detected for ringPort)
        if (sw.status === "unreachable" || next.status === "unreachable") health = "critical";
        else health = "ok";  // both switches reachable → assume link is up
      }
      links.push({ id: `${sw.switchId}:${next.switchId}`, fromSwitchId: sw.switchId, fromSwitchName: sw.name, fromPortName: fromPort?.ifName ?? "?", toSwitchId: next.switchId, toSwitchName: next.name, toPortName: toPort?.ifName ?? "?", status: health === "critical" ? "down" : "up", inMbps, outMbps, utilization, rxPowerA, rxPowerB, txPowerA, txPowerB, health });
    }
    CURRENT = { switches: snapshots, links, polledAt: new Date() };
    persistAlerts(CURRENT).catch(() => {});
    return CURRENT;
  } finally { POLLING = false; }
}

async function persistSwitchSnapshot(switchId: string, poll: PollResult, ports: PortSnapshot[], neighbors: NeighborSnapshot[]) {
  // Skip port persistence when switch is unreachable —
  // otherwise we'd keep writing/updating rows with lastPolledAt but no real data.
  if (poll.reachable && ports.length > 0) {
    for (const p of ports) {
      const existing = await db.sfpPort.findFirst({ where: { switchId, ifIndex: p.ifIndex } });
      const data = {
        switchId, ifIndex: p.ifIndex, ifName: p.ifName, ifDescr: p.ifDescr, ifAlias: p.ifAlias,
        ifSpeed: p.ifSpeed ? BigInt(p.ifSpeed.toString()) : null, ifOperStatus: p.ifOperStatus, ifAdminStatus: 1,
        txPower: p.txPower, rxPower: p.rxPower, temperature: p.temperature, voltage: p.voltage, biasCurrent: p.biasCurrent,
        txWarnLow: p.txWarnLow, txWarnHigh: p.txWarnHigh, txAlarmLow: p.txAlarmLow, txAlarmHigh: p.txAlarmHigh,
        rxWarnLow: p.rxWarnLow, rxWarnHigh: p.rxWarnHigh, rxAlarmLow: p.rxAlarmLow, rxAlarmHigh: p.rxAlarmHigh,
        inOctets: p.inOctets ? BigInt(p.inOctets.toString()) : null, outOctets: p.outOctets ? BigInt(p.outOctets.toString()) : null,
        inHCOctets: p.inOctets ? BigInt(p.inOctets.toString()) : null, outHCOctets: p.outOctets ? BigInt(p.outOctets.toString()) : null,
        inErrors: p.inErrors ? BigInt(p.inErrors.toString()) : null, outErrors: p.outErrors ? BigInt(p.outErrors.toString()) : null,
        inBps: p.inBps, outBps: p.outBps, transceiverType: p.transceiverType, vendorName: p.vendorName,
        partNumber: p.partNumber, serialNumber: p.serialNumber, isRingPort: p.isRingPort, remoteSwitchId: p.remoteSwitchId, lastPolledAt: new Date(),
      };
      if (existing) await db.sfpPort.update({ where: { id: existing.id }, data });
      else await db.sfpPort.create({ data: { ...data, id: undefined } as any });
    }
  }
  await db.switch.update({ where: { id: switchId }, data: { status: poll.reachable ? "up" : "unreachable", lastSeen: poll.reachable ? new Date() : null } });

  // Only persist CDP neighbors if the switch was actually polled via SNMP.
  // Unreachable switches (mode === "simulate") return empty neighbors array, so
  // deleting-then-recreating is a no-op here, but we skip it anyway to avoid churn.
  if (poll.reachable) {
    try {
      await db.cdpNeighbor.deleteMany({ where: { switchId } });
      if (neighbors.length > 0) {
        await db.cdpNeighbor.createMany({ data: neighbors.map((n) => ({ switchId, localIfIndex: n.localIfIndex, localIfName: n.localIfName ?? null, deviceId: n.deviceId, devicePort: n.devicePort, address: n.address, platform: n.platform, protocol: n.protocol, matchedSwitchId: n.matchedSwitchId })) });
      }
    } catch {}
  }

  // Don't write Metric / PowerSupply rows for unreachable switches.
  // Otherwise the metric table fills up with null rows every 30s.
  if (!poll.reachable) return;

  const totalInBps = ports.reduce<number>((a, p) => a + (p.inBps ?? 0), 0);
  const totalOutBps = ports.reduce<number>((a, p) => a + (p.outBps ?? 0), 0);
  const minRx = ports.map((p) => p.rxPower).filter((v): v is number => v !== null).reduce<number | null>((m, v) => (m === null ? v : Math.min(m, v)), null);
  const vals = ports.map((p) => p.rxPower).filter((v): v is number => v !== null);
  const avgRx = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  await db.metric.create({ data: { switchId, cpuUsage: poll.cpuUsage, memoryTotal: poll.memoryUsed != null && poll.memoryFree != null ? poll.memoryUsed + poll.memoryFree : null, memoryUsed: poll.memoryUsed ?? null, uptimeSeconds: poll.uptimeSeconds ?? null, totalInBps, totalOutBps, minRxPower: minRx, avgRxPower: avgRx, portsUp: ports.filter((p) => p.ifOperStatus === 1).length, portsDown: ports.filter((p) => p.ifOperStatus === 2).length, portsAlarm: ports.filter((p) => (p.rxPower != null && p.rxAlarmLow != null && p.rxPower <= p.rxAlarmLow) || p.totalErrors > 0).length, portsWarning: ports.filter((p) => p.opticalMargin !== null && p.opticalMargin < 3 && p.opticalMargin >= 0).length, totalPoeWatts: poll.power?.totalPoeWatts ?? null } });
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  await db.metric.deleteMany({ where: { timestamp: { lt: cutoff } } });
  await db.alert.deleteMany({ where: { resolved: true, resolvedAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } });

  // Persist PSU status (upsert by switchId + psuIndex)
  if (poll.power && poll.power.powerSupplies.length > 0) {
    for (const ps of poll.power.powerSupplies) {
      try {
        await db.powerSupply.upsert({
          where: { switchId_psuIndex: { switchId, psuIndex: ps.index } },
          create: { switchId, psuIndex: ps.index, status: ps.status, statusText: ps.statusText, type: ps.type },
          update: { status: ps.status, statusText: ps.statusText, type: ps.type },
        });
      } catch (e: any) {
        console.warn("[poller] PSU upsert failed:", e?.message);
      }
    }
    // Remove PSUs that no longer appear in the SNMP response
    const validIdx = poll.power.powerSupplies.map((p) => p.index);
    await db.powerSupply.deleteMany({ where: { switchId, psuIndex: { notIn: validIdx } } }).catch(() => {});
  }
}

async function persistAlerts(snapshot: Snapshot) {
  // ─── Alert thresholds ─────────────────────────────────────────────
  // Only generate alerts for SFP fiber ports that are part of the ring.
  // Access/copper ports are not monitored for optical alerts.
  //
  // 1. Rx power below -16 dBm → warning (weak receive signal)
  // 2. Tx power below -16 dBm → warning (weak transmit signal)
  // 3. Utilization above 80% → warning (traffic approaching limit)
  //    This works for any link speed: 1G at 800 Mbps = 80%, 10G at 8 Gbps = 80%
  // 4. Ring port down → critical (link failure)
  // 5. Interface errors > 0 → warning
  // 6. CPU > 80% → warning
  // 7. Memory > 85% → warning
  const RX_TX_ALERT_THRESHOLD = -16.0;
  const UTILIZATION_ALERT_THRESHOLD = 80.0;

  for (const sw of snapshot.switches) {
    for (const p of sw.ports) {
      // ── Optical alerts: ONLY for ring ports with SFP fiber ──
      // Only check Rx/Tx power if this is a ring port (isRingPort = true)
      // and it has DOM readings (txPower or rxPower is not null = SFP transceiver present)
      const isSfpFiberRingPort = p.isRingPort && (p.txPower !== null || p.rxPower !== null);

      if (isSfpFiberRingPort) {
        // Rx power alert — below -16 dBm
        if (p.rxPower != null && p.rxPower < RX_TX_ALERT_THRESHOLD) {
          await createAlertIfNew({
            switchId: sw.switchId, portId: p.portId, severity: "warning", category: "optical",
            message: `Rx power below -16 dBm on ring port ${p.ifName} (${p.switchName})`,
            value: p.rxPower.toFixed(2),
          });
        }
        // Tx power alert — below -16 dBm
        if (p.txPower != null && p.txPower < RX_TX_ALERT_THRESHOLD) {
          await createAlertIfNew({
            switchId: sw.switchId, portId: p.portId, severity: "warning", category: "optical",
            message: `Tx power below -16 dBm on ring port ${p.ifName} (${p.switchName})`,
            value: p.txPower.toFixed(2),
          });
        }
        // Transceiver-specific alarm threshold (e.g., -13 dBm) — critical
        if (p.rxPower != null && p.rxAlarmLow != null && p.rxPower <= p.rxAlarmLow) {
          await createAlertIfNew({
            switchId: sw.switchId, portId: p.portId, severity: "critical", category: "optical",
            message: `Rx power below alarm threshold on ring port ${p.ifName} (${p.switchName})`,
            value: p.rxPower.toFixed(2),
          });
        }
      }

      // ── Ring port link down alert ──
      if (p.isRingPort && p.ifOperStatus !== 1) {
        await createAlertIfNew({
          switchId: sw.switchId, portId: p.portId, severity: "critical", category: "link",
          message: `Ring port ${p.ifName} on ${p.switchName} is DOWN`,
          value: String(p.ifOperStatus),
        });
      }

      // ── Utilization alert: above 80% for any port (1G, 10G, etc.) ──
      if (p.utilization != null && p.utilization > UTILIZATION_ALERT_THRESHOLD) {
        const speedLabel = p.ifHighSpeed ? (p.ifHighSpeed >= 1000 ? `${p.ifHighSpeed / 1000}G` : `${p.ifHighSpeed}M`) : "?";
        await createAlertIfNew({
          switchId: sw.switchId, portId: p.portId,
          severity: p.utilization > 95 ? "critical" : "warning",
          category: "traffic",
          message: `High utilization on ${p.ifName} (${p.switchName}, ${speedLabel} port) — above 80%`,
          value: p.utilization.toFixed(1),
        });
      }

      // ── Interface errors alert ──
      if (p.totalErrors > 0) {
        await createAlertIfNew({
          switchId: sw.switchId, portId: p.portId,
          severity: p.totalErrors > 100 ? "critical" : "warning",
          category: "traffic",
          message: `Interface errors on ${p.ifName} (${p.switchName})`,
          value: String(p.totalErrors),
        });
      }
    }

    // ── CPU alert ──
    if (sw.cpuUsage != null && sw.cpuUsage > 80) {
      await createAlertIfNew({
        switchId: sw.switchId, portId: null,
        severity: sw.cpuUsage > 90 ? "critical" : "warning",
        category: "health",
        message: `CPU usage ${sw.cpuUsage.toFixed(1)}% on ${sw.name}`,
        value: sw.cpuUsage.toFixed(1),
      });
    }

    // ── Memory alert ──
    if (sw.memoryUsage != null && sw.memoryUsage > 85) {
      await createAlertIfNew({
        switchId: sw.switchId, portId: null,
        severity: sw.memoryUsage > 95 ? "critical" : "warning",
        category: "health",
        message: `Memory usage ${sw.memoryUsage.toFixed(1)}% on ${sw.name}`,
        value: sw.memoryUsage.toFixed(1),
      });
    }
  }
}

async function createAlertIfNew(input: { switchId: string; portId: string | null; severity: string; category: string; message: string; value?: string }) {
  // Check if there's an existing alert with the same message in the last 10 minutes.
  // This includes BOTH acknowledged AND unacknowledged alerts — so that
  // acknowledging an alert doesn't cause a duplicate to be created on the
  // next poll cycle.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const existing = await db.alert.findFirst({
    where: {
      switchId: input.switchId,
      portId: input.portId,
      message: input.message,
      timestamp: { gte: tenMinAgo },
    },
  });
  if (existing) return;
  await db.alert.create({ data: input });
}

export function getSnapshot(): Snapshot { return CURRENT; }
export function startPolling() {
  if (TIMER) return;
  runPollCycle().catch(() => {});
  TIMER = setInterval(() => { runPollCycle().catch(() => {}); }, POLL_INTERVAL_MS);
}
export function stopPolling() { if (TIMER) { clearInterval(TIMER); TIMER = null; } }
