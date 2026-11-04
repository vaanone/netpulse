import { db } from "@/lib/db";

(async () => {
  const deleted = await db.alert.deleteMany({ where: { acknowledged: true } });
  console.log(`Deleted ${deleted.count} acknowledged alerts`);
  const deletedResolved = await db.alert.deleteMany({ where: { resolved: true } });
  console.log(`Deleted ${deletedResolved.count} resolved alerts`);
  const remaining = await db.alert.count({ where: { acknowledged: false, resolved: false } });
  console.log(`Remaining active alerts: ${remaining}`);
})().finally(() => db.$disconnect());
