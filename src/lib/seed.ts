import { db } from "@/lib/db";
import { startPolling } from "@/lib/poller";

export async function ensureSeedSwitches() {
  const count = await db.switch.count();
  if (count > 0) { startPolling(); return; }
  try {
    const company = await db.company.create({ data: { name: "HiPOINT Network Solutions", description: "Demo ISP customer with three branch rings across India." } });
    const mumbai = await db.ring.create({ data: { name: "hipoint-mumbai", label: "HiPOINT — Mumbai Branch", location: "Mumbai DC, Rack A1-A3", companyId: company.id } });
    const kochi = await db.ring.create({ data: { name: "hipoint-kochi", label: "HiPOINT — Kochi Branch", location: "Kochi POP, Rack B1", companyId: company.id } });
    const pune = await db.ring.create({ data: { name: "hipoint-pune", label: "HiPOINT — Pune Branch", location: "Pune Branch Office, Rack C1", companyId: company.id } });
    const m1 = await db.switch.create({ data: { name: "Mum-Core-01", ipAddress: "10.10.1.11", location: "Mumbai DC - Rack A1", snmpVersion: 2, community: "public", snmpPort: 161, ringId: mumbai.id } });
    const m2 = await db.switch.create({ data: { name: "Mum-Edge-02", ipAddress: "10.10.1.12", location: "Mumbai DC - Rack A2", snmpVersion: 2, community: "public", snmpPort: 161, ringId: mumbai.id, nextSwitchId: m1.id } });
    await db.switch.update({ where: { id: m1.id }, data: { nextSwitchId: m2.id } });
    await db.switch.create({ data: { name: "Koc-Core-01", ipAddress: "10.10.2.11", location: "Kochi POP - Rack B1", snmpVersion: 3, v3SecurityLevel: "authPriv", v3Username: "nocadmin", v3AuthProtocol: "SHA", v3AuthPassword: "AuthPass123!", v3PrivProtocol: "AES", v3PrivPassword: "PrivPass123!", snmpPort: 161, ringId: kochi.id } });
    await db.switch.create({ data: { name: "Pun-Edge-01", ipAddress: "10.10.3.11", location: "Pune Branch - Rack C1", snmpVersion: 2, community: "public", snmpPort: 161, ringId: pune.id } });
  } catch (err: any) { if (err?.code !== "P2002") console.error("Seed error:", err); }
  startPolling();
}
