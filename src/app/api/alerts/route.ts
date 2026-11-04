import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const severity = url.searchParams.get("severity");
  const acknowledged = url.searchParams.get("acknowledged");
  const resolved = url.searchParams.get("resolved");
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const where: any = {};
  if (severity) where.severity = severity;
  if (acknowledged === "true") where.acknowledged = true;
  if (acknowledged === "false") where.acknowledged = false;
  if (resolved === "true") where.resolved = true;
  if (resolved === "false") where.resolved = false;
  const alerts = await db.alert.findMany({ where, orderBy: { timestamp: "desc" }, take: limit, include: { switch: { select: { name: true, ipAddress: true } } } });
  return NextResponse.json(alerts);
}
