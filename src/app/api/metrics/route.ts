import { NextResponse } from "next/server";
import { getSnapshot, startPolling } from "@/lib/poller";
export async function GET() {
  startPolling();
  const snapshot = getSnapshot();
  return NextResponse.json({
    switches: snapshot.switches.map((s) => ({
      ...s,
      ports: s.ports.map((p) => ({ ...p, ifSpeed: p.ifSpeed ? p.ifSpeed.toString() : null, inOctets: p.inOctets ? p.inOctets.toString() : null, outOctets: p.outOctets ? p.outOctets.toString() : null, inErrors: p.inErrors ? p.inErrors.toString() : null, outErrors: p.outErrors ? p.outErrors.toString() : null, ringPort: undefined })),
      ringPort: s.ringPort ? { ...s.ringPort, ifSpeed: s.ringPort.ifSpeed ? s.ringPort.ifSpeed.toString() : null, inOctets: s.ringPort.inOctets ? s.ringPort.inOctets.toString() : null, outOctets: s.ringPort.outOctets ? s.ringPort.outOctets.toString() : null, inErrors: s.ringPort.inErrors ? s.ringPort.inErrors.toString() : null, outErrors: s.ringPort.outErrors ? s.ringPort.outErrors.toString() : null } : null,
    })),
    links: snapshot.links,
    polledAt: snapshot.polledAt,
  });
}
