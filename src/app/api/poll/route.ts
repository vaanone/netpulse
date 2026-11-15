import { NextResponse } from "next/server";
import { runPollCycle } from "@/lib/poller";
import { requireAdmin } from "@/lib/auth";
export async function POST() {
  // Force a fresh poll cycle — don't just return the cached snapshot.
  // This is triggered by the "Poll Now" button in the dashboard.
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const snapshot = await runPollCycle(true);
  return NextResponse.json({ ok: true, polledAt: snapshot.polledAt, switchCount: snapshot.switches.length, linkCount: snapshot.links.length });
}
