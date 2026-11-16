import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  getPollIntervalMs,
  setPollIntervalMs,
  clampPollInterval,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  POLL_INTERVAL_SETTING_KEY,
} from "@/lib/poller";

// GET /api/settings/poll-interval — current server-wide poll interval.
// Available to any authenticated user (read-only); admins can change it.
export async function GET() {
  const ms = getPollIntervalMs();
  return NextResponse.json({
    intervalMs: ms,
    intervalSeconds: Math.round(ms / 1000),
    defaultMs: DEFAULT_POLL_INTERVAL_MS,
    minMs: MIN_POLL_INTERVAL_MS,
    maxMs: MAX_POLL_INTERVAL_MS,
  });
}

// PUT /api/settings/poll-interval — update the server-wide poll interval.
// Admin only. Body: { "intervalSeconds": 30 } (or "intervalMs": 30000).
// Persists to the DB (survives restarts) and applies immediately.
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Accept either seconds (friendlier for the UI) or milliseconds.
  let ms: number | null = null;
  if (typeof body.intervalSeconds === "number") ms = body.intervalSeconds * 1000;
  else if (typeof body.intervalMs === "number") ms = body.intervalMs;
  if (ms == null || !Number.isFinite(ms)) {
    return NextResponse.json({ error: "Provide intervalSeconds or intervalMs as a number." }, { status: 400 });
  }

  const clamped = clampPollInterval(ms);
  if (clamped !== ms) {
    return NextResponse.json({
      error: `Interval must be between ${MIN_POLL_INTERVAL_MS / 1000}s and ${MAX_POLL_INTERVAL_MS / 1000}s.`,
    }, { status: 400 });
  }

  // Guard: if the Prisma client was generated before the Setting model was
  // added (i.e. the user pulled the code but didn't run `db:push`/`generate`),
  // db.setting is undefined and the upsert below would throw an opaque 500.
  if (!db.setting) {
    return NextResponse.json({
      error: "The Setting table is not available. Run `bun run db:push` (or `npx prisma db push && npx prisma generate`) to create it, then restart the dev server.",
    }, { status: 500 });
  }

  try {
    await db.setting.upsert({
      where: { key: POLL_INTERVAL_SETTING_KEY },
      update: { value: String(clamped) },
      create: { key: POLL_INTERVAL_SETTING_KEY, value: String(clamped) },
    });
  } catch (e: any) {
    return NextResponse.json({
      error: "Could not save the poll interval to the database. Run `bun run db:push` to create the Setting table, then restart the dev server.",
      detail: String(e?.message ?? e),
    }, { status: 500 });
  }
  setPollIntervalMs(clamped);

  return NextResponse.json({
    intervalMs: clamped,
    intervalSeconds: Math.round(clamped / 1000),
  });
}
