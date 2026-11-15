import { NextResponse } from "next/server";
import { getCurrentUserFresh } from "@/lib/auth";

// Returns the current logged-in user (id, username, role) or 401.
// Middleware already guarantees a valid session, but we re-check the DB so a
// deleted user is reported as logged-out.
export async function GET() {
  const user = await getCurrentUserFresh();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(user);
}
