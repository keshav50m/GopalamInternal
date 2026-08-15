import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response!;

  return NextResponse.json({
    username: auth.user.username,
    role: auth.user.role,
  });
}
