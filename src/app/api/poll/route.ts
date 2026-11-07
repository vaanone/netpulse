import { NextResponse } from "next/server";
import { runPollCycle } from "@/lib/poller";
export async function POST() {
  // Force a fresh poll cycle — don't just return the cached snapshot.
  // This is triggered by the "Poll Now" button in the dashboard.
  const snapshot = await runPollCycle(true);
  return NextResponse.json({ ok: true, polledAt: snapshot.polledAt, switchCount: snapshot.switches.length, linkCount: snapshot.links.length });
}
