import { simulateSwitch } from "@/lib/snmp";
import type { Switch } from "@prisma/client";

const row: Switch = {
  id: "test1",
  name: "Core-SW-01",
  ipAddress: "192.168.1.11",
  location: null,
  snmpVersion: 2,
  community: "public",
  snmpPort: 161,
  v3SecurityLevel: null,
  v3Username: null,
  v3AuthProtocol: null,
  v3AuthPassword: null,
  v3PrivProtocol: null,
  v3PrivPassword: null,
  nextSwitchId: null,
  status: "unknown",
  lastSeen: null,
  pollingMode: "auto",
  createdAt: new Date(),
  updatedAt: new Date(),
};
try {
  const r = simulateSwitch(row, "test");
  console.log("OK mode:", r.mode, "reachable:", r.reachable, "interfaces:", r.interfaces.length);
  console.log("first if:", JSON.stringify(r.interfaces[0], (k, v) => typeof v === "bigint" ? v.toString() : v, 2));
} catch (e: any) {
  console.error("THREW:", e.message);
  console.error(e.stack);
}
