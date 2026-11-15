import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
interface RouteParams { params: Promise<{ id: string }>; }
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const updated = await db.alert.update({ where: { id }, data: { acknowledged: true } });
  return NextResponse.json(updated);
}
