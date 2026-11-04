import { db } from "@/lib/db";

(async () => {
  await db.cdpNeighbor.deleteMany();
  await db.metric.deleteMany();
  await db.alert.deleteMany();
  await db.sfpPort.deleteMany();
  await db.switch.updateMany({ data: { nextSwitchId: null } });
  await db.switch.deleteMany();
  await db.ring.deleteMany();
  await db.company.deleteMany();
  console.log("Wiped all data");
})().finally(() => db.$disconnect());
