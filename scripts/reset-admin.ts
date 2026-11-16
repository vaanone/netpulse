// Reset the admin account to admin / Hipoint@123.
// Use this when login with admin/Hipoint@123 fails because the password was
// changed, the admin user is missing, or the DB is in an inconsistent state.
//
// Run with:  bun scripts/reset-admin.ts
// (or:       npx tsx scripts/reset-admin.ts  if you have tsx installed)
//
// Safe and idempotent: preserves all switches, rings, companies, metrics and
// alerts — it only touches the single admin user row.

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

const USERNAME = "admin";
const PASSWORD = "Hipoint@123";

(async () => {
  const before = await db.user.findUnique({ where: { username: USERNAME } });
  const result = await db.user.upsert({
    where: { username: USERNAME },
    update: { passwordHash: hashPassword(PASSWORD), role: "admin" },
    create: { username: USERNAME, passwordHash: hashPassword(PASSWORD), role: "admin" },
  });
  console.log(`[reset-admin] ${before ? "updated existing" : "created"} admin user (id=${result.id}).`);
  console.log(`[reset-admin] username: '${USERNAME}'`);
  console.log(`[reset-admin] password: '${PASSWORD}'`);
  console.log(`[reset-admin] role:     'admin'`);
  console.log("[reset-admin] Done. Restart the dev server and log in.");
})().finally(() => db.$disconnect());
