import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getUsersCollection,
  hashPassword,
  requireAuthenticatedUser,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) return auth.response!;

    const body = await request.json();
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: "New passwords do not match." }, { status: 400 });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    if (!(await verifyPassword(currentPassword, auth.user.passwordHash))) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }

    if (await verifyPassword(newPassword, auth.user.passwordHash)) {
      return NextResponse.json(
        { error: "New password must be different from the current password." },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(newPassword);
    const users = await getUsersCollection();
    await users.updateOne(
      { _id: auth.user._id },
      {
        $set: { passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() },
        $inc: { authVersion: 1 },
      }
    );

    return clearSessionCookie(
      NextResponse.json({ success: true, message: "Password changed. Please log in again." })
    );
  } catch (error) {
    console.error("Change password failed:", error);
    return NextResponse.json({ error: "Unable to change password right now." }, { status: 500 });
  }
}
