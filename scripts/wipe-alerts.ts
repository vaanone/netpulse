import { db } from "@/lib/db";
(async () => {
  const count = await db.alert.count();
  console.log(`Before: ${count} alerts`);
  await db.alert.deleteMany({});
  console.log(`Deleted ALL ${count} alerts`);
  const after = await db.alert.count();
  console.log(`After: ${after} alerts`);
})().finally(() => db.$disconnect());
