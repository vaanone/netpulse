import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
interface RouteParams { params: Promise<{ id: string }>; }
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const updated = await db.alert.update({ where: { id }, data: { acknowledged: true } });
  return NextResponse.json(updated);
}
