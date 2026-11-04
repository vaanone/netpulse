import { db } from "@/lib/db";
(async () => {
  const deleted = await db.alert.deleteMany({});
  console.log(`Deleted ALL ${deleted.count} alerts — fresh start`);
})().finally(() => db.$disconnect());
