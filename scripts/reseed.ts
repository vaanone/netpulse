import { db } from "@/lib/db";

(async () => {
  // Delete all existing
  await db.cdpNeighbor.deleteMany();
  await db.metric.deleteMany();
  await db.alert.deleteMany();
  await db.sfpPort.deleteMany();
  await db.switch.updateMany({ data: { nextSwitchId: null } });
  await db.switch.deleteMany();
  await db.ring.deleteMany();
  await db.company.deleteMany();
  console.log("Wiped all data");

  // Re-create seed
  const company = await db.company.create({ data: { name: "HiPOINT Network Solutions", description: "Demo ISP customer" } });
  const mumbai = await db.ring.create({ data: { name: "hipoint-mumbai", label: "HiPOINT — Mumbai Branch", location: "Mumbai DC, Rack A1-A3", companyId: company.id } });
  const kochi = await db.ring.create({ data: { name: "hipoint-kochi", label: "HiPOINT — Kochi Branch", location: "Kochi POP, Rack B1", companyId: company.id } });
  const pune = await db.ring.create({ data: { name: "hipoint-pune", label: "HiPOINT — Pune Branch", location: "Pune Branch Office, Rack C1", companyId: company.id } });

  // Mumbai ring: 2 switches (closed ring)
  const m1 = await db.switch.create({ data: { name: "Mum-Core-01", ipAddress: "10.10.1.11", location: "Mumbai DC - Rack A1", snmpVersion: 2, community: "public", snmpPort: 161, ringId: mumbai.id } });
  const m2 = await db.switch.create({ data: { name: "Mum-Edge-02", ipAddress: "10.10.1.12", location: "Mumbai DC - Rack A2", snmpVersion: 2, community: "public", snmpPort: 161, ringId: mumbai.id, nextSwitchId: m1.id } });
  await db.switch.update({ where: { id: m1.id }, data: { nextSwitchId: m2.id } });

  // Kochi ring: 1 switch
  await db.switch.create({ data: { name: "Koc-Core-01", ipAddress: "10.10.2.11", location: "Kochi POP - Rack B1", snmpVersion: 3, v3SecurityLevel: "authPriv", v3Username: "nocadmin", v3AuthProtocol: "SHA", v3AuthPassword: "AuthPass123!", v3PrivProtocol: "AES", v3PrivPassword: "PrivPass123!", snmpPort: 161, ringId: kochi.id } });

  // Pune ring: 1 switch
  await db.switch.create({ data: { name: "Pun-Edge-01", ipAddress: "10.10.3.11", location: "Pune Branch - Rack C1", snmpVersion: 2, community: "public", snmpPort: 161, ringId: pune.id } });

  console.log("Re-seeded: 1 company, 3 rings, 4 switches");
})().finally(() => db.$disconnect());
