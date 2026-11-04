import { NextResponse } from "next/server";
import { runPollCycle } from "@/lib/poller";
export async function POST() {
  const snapshot = await runPollCycle();
  return NextResponse.json({ ok: true, polledAt: snapshot.polledAt, switchCount: snapshot.switches.length, linkCount: snapshot.links.length });
}
