import { randomInt } from "crypto";
import nodemailer from "nodemailer";
import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  findUserByUsername,
  getRequestIp,
  getUsersCollection,
  hashPassword,
  normalizeUsername,
  recordRateLimitFailure,
} from "@/lib/auth";

const GENERIC_SUCCESS =
  "If an active account matches that username, a new password has been sent to its registered email.";
const PASSWORD_CHARSETS = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnopqrstuvwxyz",
  number: "23456789",
  special: "!@#$%&*?",
};

const secureCharacter = (characters: string) =>
  characters[randomInt(0, characters.length)];

const generatePassword = () => {
  const allCharacters = Object.values(PASSWORD_CHARSETS).join("");
  const characters = [
    secureCharacter(PASSWORD_CHARSETS.upper),
    secureCharacter(PASSWORD_CHARSETS.lower),
    secureCharacter(PASSWORD_CHARSETS.number),
    secureCharacter(PASSWORD_CHARSETS.special),
    ...Array.from({ length: 12 }, () => secureCharacter(allCharacters)),
  ];

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
};

const sendPasswordEmail = async (email: string, username: string, password: string) => {
  const gmailUser = process.env.GMAIL_SMTP_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) {
    throw new Error("Gmail password reset email is not configured");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailAppPassword.replace(/\s+/g, ""),
    },
  });

  await transporter.sendMail({
    from: `Gopalam Gems & Jewellery <${gmailUser}>`,
    to: email,
    subject: "Gopalam Gems & Jewellery - New Login Password",
    text: [
      "A password reset was requested for your account.",
      "",
      `Username: ${username}`,
      `New Password: ${password}`,
      "",
      "Please log in using this password and change it after login.",
    ].join("\n"),
  });
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = normalizeUsername(body.username);
    const ip = getRequestIp(request);
    const rateLimitKeys = [`forgot:ip:${ip}`, `forgot:account:${username || "empty"}`];

    if ((await Promise.all(rateLimitKeys.map(checkRateLimit))).some(Boolean)) {
      return NextResponse.json(
        { error: "Too many password reset requests. Please try again later." },
        { status: 429 }
      );
    }

    const user = username ? await findUserByUsername(username) : null;
    if (!user || !user.isActive) {
      await Promise.all(
        rateLimitKeys.map((key) => recordRateLimitFailure(key, 1, 5, 5))
      );
      return NextResponse.json({ success: true, message: GENERIC_SUCCESS });
    }

    const newPassword = generatePassword();
    await sendPasswordEmail(user.email, user.username, newPassword);
    const passwordHash = await hashPassword(newPassword);
    const users = await getUsersCollection();
    await users.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() },
        $inc: { authVersion: 1 },
      }
    );
    await Promise.all(
      rateLimitKeys.map((key) => recordRateLimitFailure(key, 1, 5, 5))
    );

    return NextResponse.json({ success: true, message: GENERIC_SUCCESS });
  } catch (error) {
    console.error("Password reset failed before database password update:", error);
    return NextResponse.json(
      { error: "Password email could not be sent. Your existing password is unchanged." },
      { status: 503 }
    );
  }
}
