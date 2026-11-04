import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
interface RouteParams { params: Promise<{ id: string }>; }
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  await db.alert.update({ where: { id }, data: { resolved: true, resolvedAt: new Date(), acknowledged: true } });
  return NextResponse.json({ ok: true });
}
