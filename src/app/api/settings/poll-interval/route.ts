import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { setSetting } from "@/lib/server-settings";
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
// Persists to db/server-settings.json (survives restarts) and applies
// immediately — no DB migration required.
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

  try {
    setSetting(POLL_INTERVAL_SETTING_KEY, String(clamped));
  } catch (e: any) {
    return NextResponse.json({
      error: "Could not save the poll interval to the settings file.",
      detail: String(e?.message ?? e),
    }, { status: 500 });
  }
  setPollIntervalMs(clamped);

  return NextResponse.json({
    intervalMs: clamped,
    intervalSeconds: Math.round(clamped / 1000),
  });
}
