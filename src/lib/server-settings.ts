// Server-wide settings persisted to a JSON file on disk (db/server-settings.json).
//
// This avoids any Prisma schema change / migration: the file is created on
// first write and read on boot, so the poll interval and similar server-wide
// values survive restarts without needing `db:push`. The app already relies on
// a writable filesystem (SQLite at db/custom.db), so a sibling JSON file is
// consistent with its single-server deployment model.

import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "db", "server-settings.json");

type Store = Record<string, string>;

function readAll(): Store {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: Store) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.warn("[server-settings] could not write", SETTINGS_FILE, e?.message);
  }
}

// Read a setting by key. Returns `fallback` if missing / unreadable.
export function getSetting(key: string, fallback: string): string {
  const all = readAll();
  return key in all ? all[key] : fallback;
}

// Write a setting by key (merges with existing values).
export function setSetting(key: string, value: string) {
  const all = readAll();
  all[key] = value;
  writeAll(all);
}
