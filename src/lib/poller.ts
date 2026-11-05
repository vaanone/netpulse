/**
 * Polling engine — polls every switch at a fixed interval, computes traffic
 * deltas, auto-detects ring ports via CDP/LLDP, generates alerts, and caches
 * the latest snapshot for /api/metrics.
 */

import { db } from "@/lib/db";
import { pollSwitch, simulateSwitch, type PollResult } from "@/lib/snmp";

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
      try { return { sw, poll: await pollSwitch(sw) }; }
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
        return { localIfIndex: n.localIfIndex, localIfName: ifNameByIfIndex.get(n.localIfIndex) ?? null, deviceId: n.deviceId, devicePort: n.devicePort, address: n.address, platform: n.platform, protocol: n.protocol, matchedSwitchId: matchedId, matchedSwitchName: matchedName, matchedSwitchIp: matchedIp };
      });

      const remoteSwitch = sw.nextSwitchId ? switchById.get(sw.nextSwitchId) ?? null : null;
      let ringPortIfIndex: number | null = poll.ringPortIfIndex;
      let ringPortAutoDetected = false;
      let suggestedNextSwitchId: string | null = null, suggestedNextSwitchName: string | null = null, suggestedNextSwitchReason: string | null = null;

      if (poll.mode === "simulate" && remoteSwitch && !neighborSnap.some((n) => n.matchedSwitchId === sw.nextSwitchId)) {
        const ifIndex = poll.interfaces[0]?.ifIndex ?? 101;
        const ifName = ifNameByIfIndex.get(ifIndex) ?? poll.interfaces[0]?.ifName ?? "Gi1/0/1";
        neighborSnap.unshift({ localIfIndex: ifIndex, localIfName: ifName, deviceId: remoteSwitch.name, devicePort: "Gi1/0/1", address: remoteSwitch.ipAddress, platform: "Cisco IOS Software, Catalyst L3 Switch Software (SIMULATED)", protocol: "cdp", matchedSwitchId: remoteSwitch.id, matchedSwitchName: remoteSwitch.name, matchedSwitchIp: remoteSwitch.ipAddress });
      }
      if (sw.nextSwitchId) {
        const matchedToNext = neighborSnap.find((n) => n.matchedSwitchId === sw.nextSwitchId);
        if (matchedToNext) { ringPortIfIndex = matchedToNext.localIfIndex; ringPortAutoDetected = true; }
      } else {
        // No next switch configured — auto-suggest one from matched CDP neighbors.
        // Find ALL matched neighbors and pick the best one (prefer same-ring matches,
        // then any matched switch). Also show all detected neighbors in the UI.
        const allMatched = neighborSnap.filter((n) => n.matchedSwitchId !== null);
        if (allMatched.length > 0) {
          // Prefer a switch in the same ring
          const sameRingMatch = allMatched.find((n) => {
            const matchedSw = switchById.get(n.matchedSwitchId!);
            return matchedSw && matchedSw.ringId === sw.ringId;
          });
          const best = sameRingMatch ?? allMatched[0];
          if (best && best.matchedSwitchId) {
            suggestedNextSwitchId = best.matchedSwitchId;
            const sug = switchById.get(best.matchedSwitchId);
            suggestedNextSwitchName = sug?.name ?? null;
            suggestedNextSwitchReason = `CDP/LLDP neighbor on port ${best.localIfName ?? best.localIfIndex} (${best.deviceId}) matches configured switch "${sug?.name ?? "?"}" at ${best.matchedSwitchIp}`;
            ringPortIfIndex = best.localIfIndex;
            ringPortAutoDetected = true;
          }
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
        prevSwitchId: prevSwitchOf(sw.id)?.id ?? null, prevSwitchName: prevSwitchOf(sw.id)?.name ?? null, status: poll.reachable || poll.mode === "simulate" ? "up" : "unreachable",
        mode: poll.mode, error: poll.error, sysName: poll.sysName, sysDescr: poll.sysDescr, uptimeSeconds: poll.uptimeSeconds,
        cpuUsage: poll.cpuUsage, memoryUsed: poll.memoryUsed, memoryFree: poll.memoryFree, memoryTotal, memoryUsage,
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
      if (fromPort?.ifOperStatus !== 1 || toPort?.ifOperStatus !== 1) health = "critical";
      else if (rxPowerA != null && fromPort?.rxAlarmLow != null && rxPowerA <= fromPort.rxAlarmLow) health = "critical";
      else if (rxPowerB != null && toPort?.rxAlarmLow != null && rxPowerB <= toPort.rxAlarmLow) health = "critical";
      else if ((fromPort?.opticalMargin ?? 99) < 3 || (toPort?.opticalMargin ?? 99) < 3) health = "warning";
      links.push({ id: `${sw.switchId}:${next.switchId}`, fromSwitchId: sw.switchId, fromSwitchName: sw.name, fromPortName: fromPort?.ifName ?? "?", toSwitchId: next.switchId, toSwitchName: next.name, toPortName: toPort?.ifName ?? "?", status: health === "critical" ? "down" : "up", inMbps, outMbps, utilization, rxPowerA, rxPowerB, txPowerA, txPowerB, health });
    }
    CURRENT = { switches: snapshots, links, polledAt: new Date() };
    persistAlerts(CURRENT).catch(() => {});
    return CURRENT;
  } finally { POLLING = false; }
}

async function persistSwitchSnapshot(switchId: string, poll: PollResult, ports: PortSnapshot[], neighbors: NeighborSnapshot[]) {
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
  await db.switch.update({ where: { id: switchId }, data: { status: poll.reachable ? "up" : "unreachable", lastSeen: poll.reachable ? new Date() : null } });
  try {
    await db.cdpNeighbor.deleteMany({ where: { switchId } });
    if (neighbors.length > 0) {
      await db.cdpNeighbor.createMany({ data: neighbors.map((n) => ({ switchId, localIfIndex: n.localIfIndex, localIfName: n.localIfName ?? null, deviceId: n.deviceId, devicePort: n.devicePort, address: n.address, platform: n.platform, protocol: n.protocol, matchedSwitchId: n.matchedSwitchId })) });
    }
  } catch {}
  const totalInBps = ports.reduce<number>((a, p) => a + (p.inBps ?? 0), 0);
  const totalOutBps = ports.reduce<number>((a, p) => a + (p.outBps ?? 0), 0);
  const minRx = ports.map((p) => p.rxPower).filter((v): v is number => v !== null).reduce<number | null>((m, v) => (m === null ? v : Math.min(m, v)), null);
  const vals = ports.map((p) => p.rxPower).filter((v): v is number => v !== null);
  const avgRx = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  await db.metric.create({ data: { switchId, cpuUsage: poll.cpuUsage, memoryTotal: poll.memoryUsed != null && poll.memoryFree != null ? poll.memoryUsed + poll.memoryFree : null, memoryUsed: poll.memoryUsed ?? null, uptimeSeconds: poll.uptimeSeconds ?? null, totalInBps, totalOutBps, minRxPower: minRx, avgRxPower: avgRx, portsUp: ports.filter((p) => p.ifOperStatus === 1).length, portsDown: ports.filter((p) => p.ifOperStatus === 2).length, portsAlarm: ports.filter((p) => (p.rxPower != null && p.rxAlarmLow != null && p.rxPower <= p.rxAlarmLow) || p.totalErrors > 0).length, portsWarning: ports.filter((p) => p.opticalMargin !== null && p.opticalMargin < 3 && p.opticalMargin >= 0).length } });
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  await db.metric.deleteMany({ where: { timestamp: { lt: cutoff } } });
  await db.alert.deleteMany({ where: { resolved: true, resolvedAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } });
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
