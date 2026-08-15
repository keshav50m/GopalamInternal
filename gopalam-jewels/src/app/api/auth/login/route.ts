import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  clearRateLimit,
  createSessionResponse,
  findUserByUsername,
  getRequestIp,
  normalizeUsername,
  recordRateLimitFailure,
  verifyPassword,
} from "@/lib/auth";

const INVALID_LOGIN = "Invalid username or password.";
const dummyPasswordHash = hash("invalid-login-placeholder!", 10);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const rateLimitKeys = [
      `login:ip:${getRequestIp(request)}`,
      `login:account:${username || "empty"}`,
    ];

    if ((await Promise.all(rateLimitKeys.map(checkRateLimit))).some(Boolean)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429 }
      );
    }

    const user = username ? await findUserByUsername(username) : null;
    const passwordMatches = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, await dummyPasswordHash);

    if (!user || !user.isActive || !passwordMatches) {
      await Promise.all(
        rateLimitKeys.map((key) => recordRateLimitFailure(key, 5, 15, 15))
      );
      return NextResponse.json({ error: INVALID_LOGIN }, { status: 401 });
    }

    await Promise.all(rateLimitKeys.map(clearRateLimit));
    return createSessionResponse(
      user,
      NextResponse.json({ success: true, role: user.role })
    );
  } catch (error) {
    console.error("Authentication login failed:", error);
    return NextResponse.json({ error: "Unable to log in right now." }, { status: 500 });
  }
}
