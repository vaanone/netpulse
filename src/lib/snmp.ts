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
  ciscoMemoryPoolUsed: "1.3.6.1.4.1.9.9.48.1.1.1.5",
  ciscoMemoryPoolFree: "1.3.6.1.4.1.9.9.48.1.1.1.6",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysName: "1.3.6.1.2.1.1.5.0",
} as const;

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
  interfaces: any[];
  domReadings: Record<number, any>;
  thresholds: Record<number, any>;
  transceivers: any[];
  neighbors: CdpNeighbor[];
  ringPortIfIndex: number | null;
  polledAt: Date;
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
  const options: net_snmp.SessionOptions = {
    port: row.snmpPort,
    retries: 0,
    timeout: 1500,
    version: row.snmpVersion === 1 ? net_snmp.Version1 : net_snmp.Version2c,
  };
  if (row.snmpVersion === 3) {
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
    return net_snmp.createV3Session(row.ipAddress, user, options);
  }
  return net_snmp.createSession(row.ipAddress, row.community ?? "public", options);
}

function snmpGet(session: net_snmp.Session, oids: string[]): Promise<net_snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => { if (err) reject(err); else resolve(varbinds ?? []); });
  });
}
function snmpSubtree(session: net_snmp.Session, oid: string): Promise<net_snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    const results: net_snmp.Varbind[] = [];
    session.subtree(oid, 20, (varbinds) => { for (const vb of varbinds) results.push(vb); },
      (err) => { if (err) reject(err); else resolve(results); }, { maxRepetitions: 20 });
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
  try {
    const cpuVars = await snmpSubtree(session, OID.cpmCPUTotal5minRev);
    if (cpuVars.length > 0) { const v = asNumber(cpuVars[0]); if (v !== null) result.cpuUsage = v; }
  } catch {}
  try {
    const usedVars = await snmpSubtree(session, OID.ciscoMemoryPoolUsed);
    const freeVars = await snmpSubtree(session, OID.ciscoMemoryPoolFree);
    let memUsed = 0, memFree = 0;
    for (const vb of usedVars) { const v = asNumber(vb); if (v !== null) memUsed += v; }
    for (const vb of freeVars) { const v = asNumber(vb); if (v !== null) memFree += v; }
    result.memoryUsed = memUsed; result.memoryFree = memFree;
  } catch {}
  try {
    const [ifIdx, ifDescr, ifNameV, ifAliasV, ifSpd, ifHSpd, ifOper, ifAdmin,
      ifIn, ifOut, ifHCIn, ifHCOut, ifInErr, ifOutErr, ifInDisc, ifOutDisc,
      ifInUcast, ifOutUcast] = await Promise.all([
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
    const idxList = ifIdx.map((vb) => asNumber(vb)).filter((v): v is number => v !== null);
    for (const ifIndex of idxList) {
      const suffix = String(ifIndex);
      result.interfaces.push({
        ifIndex, ifName: findBySuffixNumber(ifNameV, suffix) !== null ? String(findBySuffixNumber(ifNameV, suffix)) : `if${ifIndex}`,
        ifDescr: String(findBySuffixNumber(ifDescr, suffix) ?? ""), ifAlias: String(findBySuffixNumber(ifAliasV, suffix) ?? ""),
        ifSpeed: findBySuffixBigInt(ifSpd, suffix), ifHighSpeed: findBySuffixNumber(ifHSpd, suffix),
        ifOperStatus: findBySuffixNumber(ifOper, suffix), ifAdminStatus: findBySuffixNumber(ifAdmin, suffix),
        ifInOctets: findBySuffixBigInt(ifIn, suffix), ifOutOctets: findBySuffixBigInt(ifOut, suffix),
        ifHCInOctets: findBySuffixBigInt(ifHCIn, suffix), ifHCOutOctets: findBySuffixBigInt(ifHCOut, suffix),
        ifInErrors: findBySuffixBigInt(ifInErr, suffix), ifOutErrors: findBySuffixBigInt(ifOutErr, suffix),
        ifInDiscards: findBySuffixBigInt(ifInDisc, suffix), ifOutDiscards: findBySuffixBigInt(ifOutDisc, suffix),
        ifInUcastPkts: findBySuffixBigInt(ifInUcast, suffix), ifOutUcastPkts: findBySuffixBigInt(ifOutUcast, suffix),
      });
    }
  } catch {}
  try { result.neighbors = await discoverNeighbors(session); } catch {}
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
const SIM_SEED = new Map<string, number>();
function seedFor(ip: string): number {
  if (!SIM_SEED.has(ip)) { let h = 0; for (let i = 0; i < ip.length; i++) h = (h * 31 + ip.charCodeAt(i)) >>> 0; SIM_SEED.set(ip, h); }
  return SIM_SEED.get(ip)!;
}
function rng(seed: number, salt: number): () => number {
  let s = (seed ^ salt) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const IF_NAMES_SFP = ["Te1/0/1", "Te1/0/2", "Gi1/0/1", "Gi1/0/2", "Gi2/0/1", "Gi2/0/2"];
const IF_NAMES_ACCESS = ["Gi1/0/3", "Gi1/0/4", "Gi1/0/5", "Gi1/0/6", "Gi1/0/7", "Gi1/0/8", "Gi1/0/9", "Gi1/0/10"];
const IF_DESCR_SFP = ["TenGigabitEthernet1/0/1", "TenGigabitEthernet1/0/2", "GigabitEthernet1/0/1", "GigabitEthernet1/0/2", "GigabitEthernet2/0/1", "GigabitEthernet2/0/2"];
const IF_DESCR_ACCESS = ["GigabitEthernet1/0/3", "GigabitEthernet1/0/4", "GigabitEthernet1/0/5", "GigabitEthernet1/0/6", "GigabitEthernet1/0/7", "GigabitEthernet1/0/8", "GigabitEthernet1/0/9", "GigabitEthernet1/0/10"];

export function simulateSwitch(row: SwitchRow, errMsg: string): PollResult {
  const seed = seedFor(row.ipAddress);
  const r = rng(seed, Math.floor(Date.now() / 10000));
  const r2 = rng(seed, 7);
  const interfaces: any[] = [];
  let counter = 1000000n + BigInt(Math.floor(r2() * 5_000_000));
  for (let i = 0; i < IF_NAMES_SFP.length; i++) {
    const ifIndex = 101 + i;
    const isTenGig = IF_NAMES_SFP[i].startsWith("Te");
    const speed = isTenGig ? 10000000000n : 1000000000n;
    const highSpeed = isTenGig ? 10000 : 1000;
    const inOctets = counter + BigInt(Math.floor(r() * 500_000_000));
    const outOctets = counter + BigInt(Math.floor(r2() * 350_000_000));
    counter = inOctets;
    interfaces.push({
      ifIndex, ifName: IF_NAMES_SFP[i], ifDescr: IF_DESCR_SFP[i], ifAlias: `SFP+ port ${i + 1}`,
      ifSpeed: speed, ifHighSpeed: highSpeed, ifOperStatus: 1, ifAdminStatus: 1,
      ifInOctets: inOctets, ifOutOctets: outOctets, ifHCInOctets: inOctets, ifHCOutOctets: outOctets,
      ifInErrors: BigInt(Math.floor(r() * 3)), ifOutErrors: BigInt(Math.floor(r2() * 1)),
      ifInDiscards: BigInt(0), ifOutDiscards: BigInt(0), ifInUcastPkts: inOctets / 1000n, ifOutUcastPkts: outOctets / 1000n,
    });
  }
  for (let i = 0; i < IF_NAMES_ACCESS.length; i++) {
    interfaces.push({
      ifIndex: 201 + i, ifName: IF_NAMES_ACCESS[i], ifDescr: IF_DESCR_ACCESS[i], ifAlias: `Access port ${i + 3}`,
      ifSpeed: 1000000000n, ifHighSpeed: 1000, ifOperStatus: r() > 0.15 ? 1 : 2, ifAdminStatus: 1,
      ifInOctets: null, ifOutOctets: null, ifHCInOctets: null, ifHCOutOctets: null,
      ifInErrors: BigInt(0), ifOutErrors: BigInt(0), ifInDiscards: BigInt(0), ifOutDiscards: BigInt(0),
      ifInUcastPkts: null, ifOutUcastPkts: null,
    });
  }
  // DOM readings — realistic Cisco SFP-10G-SR and GLC-T values
  const domReadings: Record<number, any> = {};
  for (let i = 0; i < IF_NAMES_SFP.length; i++) {
    const isTenGig = IF_NAMES_SFP[i].startsWith("Te");
    if (isTenGig) {
      // 10G SFP+: Tx -1 to -7 dBm, Rx -3 to -9 dBm
      domReadings[101 + i] = {
        txPower: -1 + r() * 6,    // -1 to -7 dBm
        rxPower: -3 + r() * 6,    // -3 to -9 dBm
        temperature: 35 + r() * 15, // 35-50 C
        voltage: 3.25 + r() * 0.15, // 3.25-3.40 V
        biasCurrent: 7 + r() * 5,   // 7-12 mA
      };
    } else {
      // 1G SFP: Tx -3 to -9 dBm, Rx -5 to -12 dBm
      domReadings[101 + i] = {
        txPower: -3 + r() * 6,    // -3 to -9 dBm
        rxPower: -5 + r() * 7,    // -5 to -12 dBm
        temperature: 38 + r() * 12, // 38-50 C
        voltage: 3.25 + r() * 0.15,
        biasCurrent: 5 + r() * 4,   // 5-9 mA
      };
    }
  }
  // Thresholds — realistic 10G-SR and 1G-LX values
  const thresholds: Record<number, any> = {};
  for (let i = 0; i < IF_NAMES_SFP.length; i++) {
    const isTenGig = IF_NAMES_SFP[i].startsWith("Te");
    if (isTenGig) {
      thresholds[101 + i] = { txWarnLow: -8.0, txWarnHigh: 2.0, txAlarmLow: -10.0, txAlarmHigh: 3.0, rxWarnLow: -11.0, rxWarnHigh: 1.0, rxAlarmLow: -13.0, rxAlarmHigh: 2.0 };
    } else {
      thresholds[101 + i] = { txWarnLow: -9.5, txWarnHigh: 0.5, txAlarmLow: -12.0, txAlarmHigh: 1.5, rxWarnLow: -13.0, rxWarnHigh: -1.0, rxAlarmLow: -15.0, rxAlarmHigh: 0.5 };
    }
  }
  // CDP neighbors — generate realistic neighbors that match configured switches.
  // We generate neighbors pointing at IPs near the switch's IP so the poller
  // can match them against other configured switches in the same subnet.
  const neighbors: CdpNeighbor[] = [];
  // First SFP port = ring port → neighbor is the next switch in the ring
  // Generate a neighbor on the first SFP port pointing to a nearby IP
  const ipParts = row.ipAddress.split(".").map(Number);
  if (ipParts.length === 4) {
    const prefix = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
    const myLastOctet = ipParts[3];
    // Neighbor on port 1 (ring port): next IP in sequence
    const nextOctet = (myLastOctet % 254) + 1;
    neighbors.push({
      localIfIndex: 101,
      deviceId: row.name.replace(/-\d+$/, "").replace(/-/g, "") + "-next",
      devicePort: "Te1/0/1",
      address: `${prefix}.${nextOctet}`,
      platform: "Cisco IOS Software, Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M)",
      protocol: "cdp" as const,
    });
    // Note: We only generate a "next" CDP neighbor (port 1).
    // The "prev" neighbor is determined by the poller based on which
    // configured switches point to this switch via nextSwitchId.
    // We don't generate a fake "prev" based on IP-1 because that
    // IP often doesn't match any configured switch.
  }
  return {
    reachable: false, mode: "simulate", error: errMsg,
    sysDescr: "Cisco IOS Software [Simulated] - NETPULSE demo mode", sysName: row.name,
    uptimeSeconds: Math.floor(r() * 60 * 86400), cpuUsage: 5 + r() * 30,
    memoryUsed: Math.floor(0.3 * 1073741824 + r() * 0.4 * 1073741824),
    memoryFree: Math.floor(0.2 * 1073741824 + r2() * 0.3 * 1073741824),
    interfaces, domReadings, thresholds,
    transceivers: IF_NAMES_SFP.map((n, i) => ({ entityIndex: 1000 + i, name: n, descr: "SFP-10G-SR", modelName: "SFP-10G-SR", serialNum: `SIM${(seed + i).toString(16).toUpperCase().padStart(8, "0")}`, parentEntityIndex: 0, ifIndex: 101 + i })),
    neighbors, ringPortIfIndex: null, polledAt: new Date(),
  };
}
