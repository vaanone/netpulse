/**
 * Cisco SNMP polling service for NETPULSE.
 * Polls Cisco switches via SNMP (v1/v2c/v3) to retrieve SFP DOM readings,
 * interface counters, CPU/memory, and CDP/LLDP neighbors.
 * Falls back to deterministic simulation when switches are unreachable.
 */

import net_snmp from "net-snmp";
import type { Switch as SwitchRow } from "@prisma/client";

export const OID = {
  ifIndex: "1.3.6.1.2.1.2.2.1.1",
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifSpeed: "1.3.6.1.2.1.2.2.1.5",
  ifAdminStatus: "1.3.6.1.2.1.2.2.1.7",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
  ifInOctets: "1.3.6.1.2.1.2.2.1.10",
  ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
  ifInErrors: "1.3.6.1.2.1.2.2.1.14",
  ifOutErrors: "1.3.6.1.2.1.2.2.1.20",
  ifInDiscards: "1.3.6.1.2.1.2.2.1.13",
  ifOutDiscards: "1.3.6.1.2.1.2.2.1.19",
  ifInUcastPkts: "1.3.6.1.2.1.2.2.1.11",
  ifOutUcastPkts: "1.3.6.1.2.1.2.2.1.17",
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
  ifHighSpeed: "1.3.6.1.2.1.31.1.1.1.15",
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  cdpCacheDeviceId: "1.3.6.1.4.1.9.9.23.1.2.1.1.6",
  cdpCacheDevicePort: "1.3.6.1.4.1.9.9.23.1.2.1.1.7",
  cdpCachePlatform: "1.3.6.1.4.1.9.9.23.1.2.1.1.8",
  cdpCacheAddress: "1.3.6.1.4.1.9.9.23.1.2.1.1.4",
  lldpRemSysName: "1.3.6.1.2.1.105.1.7.1.4",
  lldpRemPortDesc: "1.3.6.1.2.1.105.1.7.1.5",
  lldpRemPortId: "1.3.6.1.2.1.105.1.7.1.3",
  cpmCPUTotal5minRev: "1.3.6.1.4.1.9.9.109.1.1.1.1.8",
  cpmCPUTotal1minRev: "1.3.6.1.4.1.9.9.109.1.1.1.1.7",   // older IOS fallback
  cpmCPUTotal5secRev: "1.3.6.1.4.1.9.9.109.1.1.1.1.6",   // even older fallback
  cpmCPUTotal5sec:    "1.3.6.1.4.1.9.9.109.1.1.1.1.3",   // legacy (pre-Restricted)
  // Cisco SMB MIBs — used by Catalyst 1000/1300/1400 series, SMB SG/SE series.
  // These don't support CISCO-PROCESS-MIB; they use the legacy "rl" (Linksys) MIBs.
  rlCpuUsage:         "1.3.6.1.4.1.9.6.1.101.7.0",        // 5-min CPU average (0-100)
  rlCpuUsage1min:     "1.3.6.1.4.1.9.6.1.101.10.0",       // 1-min CPU average
  rlMemoryPoolTotal:  "1.3.6.1.4.1.9.6.1.101.21.1.0",     // total memory in bytes
  rlMemoryPoolFree:   "1.3.6.1.4.1.9.6.1.101.21.2.0",     // free memory in bytes
  ciscoMemoryPoolUsed: "1.3.6.1.4.1.9.9.48.1.1.1.5",
  ciscoMemoryPoolFree: "1.3.6.1.4.1.9.9.48.1.1.1.6",
  // Power supply status (CISCO-ENTITY-FRU-CONTROL-MIB)
  cefcFRUPowerSupplyStatus: "1.3.6.1.4.1.9.9.117.1.1.2.1.2",  // operStatus: 1=on, 2=off, 3=failed, 4=on-but-fan-fail
  cefcFRUPowerSupplyType:  "1.3.6.1.4.1.9.9.117.1.1.2.1.1",    // psClass: 1=AC, 2=DC, 3=AC-Redundant
  // Total PoE power consumption per port (CISCO-POWER-ETHERNET-EXT-MIB)
  cpeExtPsePortPwrConsumption: "1.3.6.1.4.1.9.9.402.1.2.1.1.7",  // milliWatts consumed on the port
  // Total power drawn by all PSE (CISCO-POWER-ETHERNET-MIB)
  pethMainPseConsumptionPower: "1.3.6.1.2.1.105.1.1.1.4",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysName: "1.3.6.1.2.1.1.5.0",
} as const;

export interface PowerSupply {
  index: number;
  status: number;        // 1=on, 2=off, 3=failed, 4=on-but-fan-fail, 5=off-env-other, 6=off-cooling
  statusText: "on" | "off" | "failed" | "fan-fail" | "env-other" | "cooling" | "unknown";
  type: string | null;   // "AC", "DC", "AC-Redundant", etc.
}

export interface PowerSummary {
  powerSupplies: PowerSupply[];
  totalPoeMilliWatts: number | null;  // PoE total power consumption (across all PSE groups)
  totalPoeWatts: number | null;
}

export interface CdpNeighbor {
  localIfIndex: number;
  localIfName?: string | null;
  deviceId: string;
  devicePort: string;
  address: string | null;
  platform: string | null;
  protocol: "cdp" | "lldp";
}

export interface PollResult {
  reachable: boolean;
  mode: "snmp" | "simulate";
  error?: string;
  sysDescr?: string | null;
  sysName?: string | null;
  uptimeSeconds?: number | null;
  cpuUsage?: number | null;
  memoryUsed?: number | null;
  memoryFree?: number | null;
  power?: PowerSummary | null;
  interfaces: any[];
  domReadings: Record<number, any>;
  thresholds: Record<number, any>;
  transceivers: any[];
  neighbors: CdpNeighbor[];
  ringPortIfIndex: number | null;
  polledAt: Date;
}

const PSU_STATUS_TEXT: Record<number, PowerSupply["statusText"]> = {
  1: "on", 2: "off", 3: "failed", 4: "fan-fail",
  5: "env-other", 6: "cooling",
};
const PSU_TYPE_TEXT: Record<number, string> = {
  1: "AC", 2: "DC", 3: "AC-Redundant", 4: "DC-Redundant", 5: "AC-DC",
};

async function pollPower(session: net_snmp.Session): Promise<PowerSummary | null> {
  const powerSupplies: PowerSupply[] = [];
  let totalPoeMilliWatts: number | null = null;

  // Power supply status (CISCO-ENTITY-FRU-CONTROL-MIB)
  try {
    const [statusVars, typeVars] = await Promise.all([
      snmpSubtree(session, OID.cefcFRUPowerSupplyStatus),
      snmpSubtree(session, OID.cefcFRUPowerSupplyType),
    ]);
    for (const vb of statusVars) {
      const idx = parseInt(vb.oid.split(".").pop() ?? "", 10);
      if (!Number.isFinite(idx)) continue;
      const statusNum = asNumber(vb);
      if (statusNum == null) continue;
      const typeNum = typeVars.find((t) => t.oid.endsWith("." + idx)) ? asNumber(typeVars.find((t) => t.oid.endsWith("." + idx))!) : null;
      powerSupplies.push({
        index: idx,
        status: statusNum,
        statusText: PSU_STATUS_TEXT[statusNum] ?? "unknown",
        type: typeNum != null ? (PSU_TYPE_TEXT[typeNum] ?? `Class ${typeNum}`) : null,
      });
    }
  } catch {}

  // Total PoE power consumption across all PSE groups (POWER-ETHERNET-MIB)
  try {
    const poeVars = await snmpSubtree(session, OID.pethMainPseConsumptionPower);
    if (poeVars.length > 0) {
      let sum = 0;
      let found = false;
      for (const vb of poeVars) {
        const v = asNumber(vb);
        if (v != null) { sum += v; found = true; }
      }
      // pethMainPseConsumptionPower is in milliWatts
      if (found) totalPoeMilliWatts = sum;
    }
  } catch {}

  if (powerSupplies.length === 0 && totalPoeMilliWatts == null) return null;
  return {
    powerSupplies,
    totalPoeMilliWatts,
    totalPoeWatts: totalPoeMilliWatts != null ? totalPoeMilliWatts / 1000 : null,
  };
}

function securityLevelFromString(s: string | null | undefined): net_snmp.SecurityLevel {
  if (!s) return net_snmp.SecurityLevel.noAuthNoPriv;
  switch (s.toLowerCase()) {
    case "authpriv": return net_snmp.SecurityLevel.authPriv;
    case "authnopriv": return net_snmp.SecurityLevel.authNoPriv;
    default: return net_snmp.SecurityLevel.noAuthNoPriv;
  }
}

function createSession(row: SwitchRow): net_snmp.Session {
  if (row.snmpVersion === 3) {
    // SNMPv3 — do NOT set `version` in options, otherwise net-snmp throws:
    //   "SNMPv3 session requested but version '1' specified in options"
    const user: net_snmp.User = {
      name: row.v3Username ?? "",
      level: securityLevelFromString(row.v3SecurityLevel),
    };
    if (row.v3AuthProtocol) {
      user.authProtocol = row.v3AuthProtocol.toUpperCase() === "MD5" ? net_snmp.AuthProtocols.md5 : net_snmp.AuthProtocols.sha;
      user.authKey = row.v3AuthPassword ?? "";
    }
    if (row.v3PrivProtocol) {
      user.privProtocol = row.v3PrivProtocol.toUpperCase() === "AES" ? net_snmp.PrivProtocols.aes : net_snmp.PrivProtocols.des;
      user.privKey = row.v3PrivPassword ?? "";
    }
    const v3Options: net_snmp.SessionOptions = {
      port: row.snmpPort, retries: 0, timeout: 1500,
    };
    return net_snmp.createV3Session(row.ipAddress, user, v3Options);
  }
  // SNMPv1 / v2c
  const options: net_snmp.SessionOptions = {
    port: row.snmpPort,
    retries: 0,
    timeout: 1500,
    version: row.snmpVersion === 1 ? net_snmp.Version1 : net_snmp.Version2c,
  };
  return net_snmp.createSession(row.ipAddress, row.community ?? "public", options);
}

function snmpGet(session: net_snmp.Session, oids: string[]): Promise<net_snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => { if (err) reject(err); else resolve(varbinds ?? []); });
  });
}
function snmpSubtree(session: net_snmp.Session, oid: string): Promise<net_snmp.Varbind[]> {
  return new Promise((resolve) => {
    const results: net_snmp.Varbind[] = [];
    session.subtree(oid, 20, (varbinds) => { for (const vb of varbinds) results.push(vb); },
      (err) => {
        // Don't reject — return whatever we have so far. Different Cisco IOS
        // versions don't support every MIB. A missing OID should NOT bring
        // down the whole batch via Promise.all.
        // Common non-fatal errors:
        //   - "No such name" / "noSuchInstance" → OID not supported
        //   - "Request timed out" → too many OIDs in this subtree
        resolve(results);
      }, { maxRepetitions: 20 });
  });
}
function asNumber(vb: net_snmp.Varbind): number | null {
  if (!vb || vb.value === null || vb.value === undefined) return null;
  const v = vb.value;
  if (typeof v === "number") return v;
  if (Buffer.isBuffer(v)) return v.length === 8 ? Number(v.readBigUInt64BE(0)) : Number(v.readInt32BE(0));
  if (typeof v === "bigint") return Number(v);
  return null;
}
function asBigInt(vb: net_snmp.Varbind): bigint | null {
  if (!vb || vb.value === null || vb.value === undefined) return null;
  const v = vb.value;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (Buffer.isBuffer(v)) return v.length === 8 ? v.readBigUInt64BE(0) : BigInt(v.readInt32BE(0));
  return null;
}
function asString(vb: net_snmp.Varbind): string | null {
  if (!vb || vb.value === null || vb.value === undefined) return null;
  const v = vb.value;
  if (typeof v === "string") return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8").replace(/\0+$/, "");
  if (typeof v === "number") return String(v);
  return null;
}
function findValueBySuffix<T>(varbinds: net_snmp.Varbind[], suffix: string, read: (vb: net_snmp.Varbind) => T): T | null {
  for (const vb of varbinds) {
    const parts = vb.oid.split(".");
    if (parts[parts.length - 1] === suffix) return read(vb);
  }
  return null;
}
function findBySuffixNumber(varbinds: net_snmp.Varbind[], suffix: string): number | null {
  return findValueBySuffix(varbinds, suffix, asNumber);
}
function findBySuffixBigInt(varbinds: net_snmp.Varbind[], suffix: string): bigint | null {
  return findValueBySuffix(varbinds, suffix, asBigInt);
}
function findBySuffixString(varbinds: net_snmp.Varbind[], suffix: string): string | null {
  return findValueBySuffix(varbinds, suffix, asString);
}

export async function pollSwitch(row: SwitchRow): Promise<PollResult> {
  let session: net_snmp.Session | null = null;
  try {
    session = createSession(row);
    const result = await pollRealSwitch(session, row);
    const hasAnyData =
      (result.sysDescr ?? null) !== null || (result.sysName ?? null) !== null ||
      (result.uptimeSeconds ?? null) !== null || (result.cpuUsage ?? null) !== null ||
      result.interfaces.length > 0 || Object.keys(result.domReadings).length > 0 ||
      result.transceivers.length > 0 || result.neighbors.length > 0;
    if (!hasAnyData) {
      try { session.close(); } catch {}
      return simulateSwitch(row, "SNMP timeout — switch unreachable from server");
    }
    return result;
  } catch (err: any) {
    if (session) { try { session.close(); } catch {} }
    return simulateSwitch(row, err?.message ?? "SNMP unreachable");
  } finally {
    if (session) { try { session.close(); } catch {} }
  }
}

async function pollRealSwitch(session: net_snmp.Session, row: SwitchRow): Promise<PollResult> {
  const result: PollResult = {
    reachable: true, mode: "snmp", interfaces: [], domReadings: {}, thresholds: {},
    transceivers: [], neighbors: [], ringPortIfIndex: null, polledAt: new Date(),
  };
  try {
    const sysVars = await snmpGet(session, [OID.sysDescr, OID.sysName, OID.sysUpTime]);
    result.sysDescr = asString(sysVars[0]);
    result.sysName = asString(sysVars[1]);
    const up = asNumber(sysVars[2]);
    if (up !== null) result.uptimeSeconds = Math.floor(up / 100);
  } catch {}
  // CPU usage — try 5min, fall back to 1min, then 5sec.
  // Different Cisco IOS versions expose different OIDs. Older IOS (12.2) only has cpmCPUTotal5sec.
  // For SMB switches (Catalyst 1000/1300/1400, SG/SE series), CISCO-PROCESS-MIB is NOT supported;
  // they use the rlCpuUsage OID from the legacy Linksys/SMB MIB tree (1.3.6.1.4.1.9.6.1.101.x).
  try {
    let cpuVars = await snmpSubtree(session, OID.cpmCPUTotal5minRev);
    if (cpuVars.length === 0) cpuVars = await snmpSubtree(session, OID.cpmCPUTotal1minRev);
    if (cpuVars.length === 0) cpuVars = await snmpSubtree(session, OID.cpmCPUTotal5secRev);
    if (cpuVars.length === 0) cpuVars = await snmpSubtree(session, OID.cpmCPUTotal5sec);
    if (cpuVars.length > 0) {
      const v = asNumber(cpuVars[0]);
      if (v !== null) result.cpuUsage = v;
    }
    // SMB fallback (Catalyst 1300/1000/SG/SE) — these are scalar OIDs (.0 suffix), use GET not SUBTREE
    if (result.cpuUsage == null) {
      try {
        const smbCpu = await snmpGet(session, [OID.rlCpuUsage]);
        const v = asNumber(smbCpu[0]);
        if (v !== null && v >= 0 && v <= 100) result.cpuUsage = v;
      } catch {}
    }
    if (result.cpuUsage == null) {
      try {
        const smbCpu = await snmpGet(session, [OID.rlCpuUsage1min]);
        const v = asNumber(smbCpu[0]);
        if (v !== null && v >= 0 && v <= 100) result.cpuUsage = v;
      } catch {}
    }
  } catch (e: any) { console.warn("[snmp] CPU poll failed:", e?.message); }
  // Memory — ciscoMemoryPoolUsed/Free (CISCO-MEMORY-POOL-MIB) for classic IOS.
  // For SMB switches (Catalyst 1000/1300/1400, SG/SE) — falls back to rlMemoryPoolTotal/Free.
  try {
    const [usedVars, freeVars] = await Promise.all([
      snmpSubtree(session, OID.ciscoMemoryPoolUsed),
      snmpSubtree(session, OID.ciscoMemoryPoolFree),
    ]);
    let memUsed = 0, memFree = 0;
    for (const vb of usedVars) { const v = asNumber(vb); if (v !== null) memUsed += v; }
    for (const vb of freeVars) { const v = asNumber(vb); if (v !== null) memFree += v; }
    if (memUsed > 0 || memFree > 0) {
      result.memoryUsed = memUsed; result.memoryFree = memFree;
    }
    // SMB fallback (Catalyst 1300/1000/SG/SE) — scalar OIDs
    if (result.memoryUsed == null) {
      try {
        const [totalV, freeV] = await snmpGet(session, [OID.rlMemoryPoolTotal, OID.rlMemoryPoolFree]);
        const total = asNumber(totalV);
        const free = asNumber(freeV);
        if (total != null && free != null && total > 0) {
          result.memoryUsed = total - free;
          result.memoryFree = free;
        }
      } catch {}
    }
  } catch (e: any) { console.warn("[snmp] Memory poll failed:", e?.message); }
  // Interfaces — use Promise.allSettled so a single failed OID (e.g. ifHCInOctets
  // on a 32-bit-only counter, or ifAlias not configured) does NOT kill the whole batch.
  try {
    const settled = await Promise.allSettled([
      snmpSubtree(session, OID.ifIndex), snmpSubtree(session, OID.ifDescr),
      snmpSubtree(session, OID.ifName), snmpSubtree(session, OID.ifAlias),
      snmpSubtree(session, OID.ifSpeed), snmpSubtree(session, OID.ifHighSpeed),
      snmpSubtree(session, OID.ifOperStatus), snmpSubtree(session, OID.ifAdminStatus),
      snmpSubtree(session, OID.ifInOctets), snmpSubtree(session, OID.ifOutOctets),
      snmpSubtree(session, OID.ifHCInOctets), snmpSubtree(session, OID.ifHCOutOctets),
      snmpSubtree(session, OID.ifInErrors), snmpSubtree(session, OID.ifOutErrors),
      snmpSubtree(session, OID.ifInDiscards), snmpSubtree(session, OID.ifOutDiscards),
      snmpSubtree(session, OID.ifInUcastPkts), snmpSubtree(session, OID.ifOutUcastPkts),
    ]);
    const got = (i: number): net_snmp.Varbind[] =>
      settled[i].status === "fulfilled" ? settled[i].value : [];
    const ifIdx = got(0), ifDescr = got(1), ifNameV = got(2), ifAliasV = got(3),
      ifSpd = got(4), ifHSpd = got(5), ifOper = got(6), ifAdmin = got(7),
      ifIn = got(8), ifOut = got(9), ifHCIn = got(10), ifHCOut = got(11),
      ifInErr = got(12), ifOutErr = got(13), ifInDisc = got(14), ifOutDisc = got(15),
      ifInUcast = got(16), ifOutUcast = got(17);
    const idxList = ifIdx.map((vb) => asNumber(vb)).filter((v): v is number => v !== null);
    if (idxList.length === 0) {
      console.warn("[snmp] ifIndex subtree returned 0 entries — switch may not expose IF-MIB");
    }
    for (const ifIndex of idxList) {
      const suffix = String(ifIndex);
      const name = findBySuffixString(ifNameV, suffix);
      const descr = findBySuffixString(ifDescr, suffix);
      const alias = findBySuffixString(ifAliasV, suffix);
      result.interfaces.push({
        ifIndex,
        ifName: name ?? descr ?? `if${ifIndex}`,
        ifDescr: descr ?? "",
        ifAlias: alias ?? "",
        ifSpeed: findBySuffixBigInt(ifSpd, suffix), ifHighSpeed: findBySuffixNumber(ifHSpd, suffix),
        ifOperStatus: findBySuffixNumber(ifOper, suffix), ifAdminStatus: findBySuffixNumber(ifAdmin, suffix),
        ifInOctets: findBySuffixBigInt(ifIn, suffix), ifOutOctets: findBySuffixBigInt(ifOut, suffix),
        ifHCInOctets: findBySuffixBigInt(ifHCIn, suffix), ifHCOutOctets: findBySuffixBigInt(ifHCOut, suffix),
        ifInErrors: findBySuffixBigInt(ifInErr, suffix), ifOutErrors: findBySuffixBigInt(ifOutErr, suffix),
        ifInDiscards: findBySuffixBigInt(ifInDisc, suffix), ifOutDiscards: findBySuffixBigInt(ifOutDisc, suffix),
        ifInUcastPkts: findBySuffixBigInt(ifInUcast, suffix), ifOutUcastPkts: findBySuffixBigInt(ifOutUcast, suffix),
      });
    }
  } catch (e: any) { console.warn("[snmp] Interface poll failed:", e?.message); }
  try { result.neighbors = await discoverNeighbors(session); } catch {}
  try { result.power = await pollPower(session); } catch { result.power = null; }
  return result;
}

async function discoverNeighbors(session: net_snmp.Session): Promise<CdpNeighbor[]> {
  const neighbors: CdpNeighbor[] = [];
  const seen = new Set<string>();
  try {
    const [devIdVars, devPortVars, addrVars, platVars] = await Promise.all([
      snmpSubtree(session, OID.cdpCacheDeviceId), snmpSubtree(session, OID.cdpCacheDevicePort),
      snmpSubtree(session, OID.cdpCacheAddress), snmpSubtree(session, OID.cdpCachePlatform),
    ]);
    for (const vb of devIdVars) {
      const parts = vb.oid.split(".");
      if (parts.length < 2) continue;
      const localIfIndex = parseInt(parts[parts.length - 2], 10);
      const deviceId = asString(vb);
      if (!deviceId || !Number.isFinite(localIfIndex)) continue;
      const portSuffix = parts.slice(-2).join(".");
      const devicePort = devPortVars.find((p) => p.oid.endsWith("." + portSuffix)) ? (asString(devPortVars.find((p) => p.oid.endsWith("." + portSuffix))!) ?? "") : "";
      const addrVb = addrVars.find((p) => p.oid.endsWith("." + portSuffix));
      const address = addrVb ? decodeCdpAddress(addrVb) : null;
      const platform = platVars.find((p) => p.oid.endsWith("." + portSuffix)) ? asString(platVars.find((p) => p.oid.endsWith("." + portSuffix))!) : null;
      const dedup = `${localIfIndex}|${deviceId}|${devicePort}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      neighbors.push({ localIfIndex, deviceId, devicePort, address, platform, protocol: "cdp" });
    }
  } catch {}
  try {
    const [sysNameVars, portDescVars, portIdVars] = await Promise.all([
      snmpSubtree(session, OID.lldpRemSysName), snmpSubtree(session, OID.lldpRemPortDesc),
      snmpSubtree(session, OID.lldpRemPortId),
    ]);
    for (const vb of sysNameVars) {
      const parts = vb.oid.split(".");
      if (parts.length < 3) continue;
      const localPortNum = parseInt(parts[parts.length - 2], 10);
      const deviceId = asString(vb);
      if (!deviceId || !Number.isFinite(localPortNum)) continue;
      const suffix = parts.slice(-3).join(".");
      const portVb = portDescVars.find((p) => p.oid.endsWith("." + suffix));
      const portIdVb = portIdVars.find((p) => p.oid.endsWith("." + suffix));
      const devicePort = portVb ? (asString(portVb) ?? "") : portIdVb ? (asString(portIdVb) ?? "") : "";
      const dedup = `${localPortNum}|${deviceId}|${devicePort}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      neighbors.push({ localIfIndex: localPortNum, deviceId, devicePort, address: null, platform: null, protocol: "lldp" });
    }
  } catch {}
  return neighbors;
}

function decodeCdpAddress(vb: net_snmp.Varbind): string | null {
  if (!vb || vb.value === null || vb.value === undefined) return null;
  let buf: Buffer;
  if (Buffer.isBuffer(vb.value)) buf = vb.value;
  else if (typeof vb.value === "string") buf = Buffer.from(vb.value, "utf8");
  else if (typeof vb.value === "number") { buf = Buffer.alloc(4); buf.writeUInt32BE(vb.value >>> 0, 0); }
  else return null;
  if (buf.length < 8) return null;
  const ipv4 = buf.slice(4, 8);
  return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.${ipv4[3]}`;
}

// ─── Simulation fallback ──────────────────────────────────────────────────
// When the switch is unreachable from the server, NO fake data is returned.
// All values are null/empty — the UI displays "—" / 0 / empty rows for them.
// This ensures that what you see in the dashboard is always real SNMP data
// polled from the actual device, never invented numbers.
export function simulateSwitch(row: SwitchRow, errMsg: string): PollResult {
  return {
    reachable: false,
    mode: "simulate",
    error: errMsg,
    sysDescr: null,
    sysName: null,
    uptimeSeconds: null,
    cpuUsage: null,
    memoryUsed: null,
    memoryFree: null,
    power: null,
    interfaces: [],
    domReadings: {},
    thresholds: {},
    transceivers: [],
    neighbors: [],
    ringPortIfIndex: null,
    polledAt: new Date(),
  };
}
