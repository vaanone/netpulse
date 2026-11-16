// Diagnostic: check whether admin / Hipoint@123 verifies against the DB hash.
import { Database } from "bun:sqlite";
import { scryptSync, timingSafeEqual } from "crypto";

const dbPath = process.argv[2] ?? "db/custom.db";
const db = new Database(dbPath, { readonly: true });

// Find all users (the table might be User or user depending on Prisma mapping).
let rows: { username: string; passwordHash: string }[] = [];
for (const table of ["User", "user", "users", "Account"]) {
  try {
    rows = db.query(`SELECT username, "passwordHash" FROM ${table}`).all() as any;
    console.log(`[db] read from table: ${table} (${rows.length} rows)`);
    break;
  } catch {
    // table doesn't exist — try next
  }
}

if (!rows.length) {
  console.log("[result] NO USERS FOUND in DB. Login cannot work — the DB has no users.");
  console.log("[hint] Re-seed: `npx prisma db push` then run the seed script, OR start dev so the seed runs.");
  process.exit(0);
}

function verify(password: string, stored: string): boolean {
  // Format: scrypt$saltB64$hashB64
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

console.log("[db] users:", rows.map(r => r.username).join(", "));
for (const u of rows) {
  const ok = verify("Hipoint@123", u.passwordHash);
  console.log(`[result] user='${u.username}' verify('Hipoint@123')=${ok ? "TRUE ✓" : "FALSE ✗"}`);
  console.log(`[hash]   scheme/format: ${u.passwordHash.split("$")[0]} (len=${u.passwordHash.length})`);
}
