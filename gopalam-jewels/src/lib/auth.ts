import { compare, hash } from "bcryptjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Collection } from "mongodb";
import clientPromise from "@/lib/mongodb";
import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth-shared";

export type UserDocument = {
  _id?: ObjectId;
  username: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
  passwordChangedAt: Date;
};

type RateLimitDocument = {
  key: string;
  count: number;
  windowStartedAt: Date;
  blockedUntil?: Date;
  expiresAt: Date;
};

let authIndexesPromise: Promise<unknown> | null = null;

const getCollections = async () => {
  const client = await clientPromise;
  const db = client.db("gopalamJewels");
  return {
    users: db.collection<UserDocument>("users"),
    rateLimits: db.collection<RateLimitDocument>("authRateLimits"),
  };
};

export const ensureAuthIndexes = async () => {
  if (!authIndexesPromise) {
    authIndexesPromise = getCollections().then(({ users, rateLimits }) =>
      Promise.all([
        users.createIndex({ username: 1 }, { unique: true, name: "username_unique" }),
        users.createIndex({ email: 1 }, { name: "email_lookup" }),
        rateLimits.createIndex({ key: 1 }, { unique: true, name: "rate_limit_key_unique" }),
        rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "rate_limit_ttl" }),
      ])
    );
  }
  return authIndexesPromise;
};

export const normalizeUsername = (value: unknown) =>
  String(value || "").trim().toLowerCase();

export const validatePassword = (password: unknown) => {
  if (typeof password !== "string" || password.length < 10) {
    return "Password must be at least 10 characters long and include a special character.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must be at least 10 characters long and include a special character.";
  }
  return null;
};

export const hashPassword = (password: string) => hash(password, 12);
export const verifyPassword = (password: string, passwordHash: string) =>
  compare(password, passwordHash);

export const findUserByUsername = async (username: string) => {
  await ensureAuthIndexes();
  const { users } = await getCollections();
  return users.findOne({ username: normalizeUsername(username) });
};

export const getRequestIp = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "unknown";

const getRateLimit = async (
  collection: Collection<RateLimitDocument>,
  key: string
) => collection.findOne({ key });

export const checkRateLimit = async (key: string) => {
  await ensureAuthIndexes();
  const { rateLimits } = await getCollections();
  const entry = await getRateLimit(rateLimits, key);
  return Boolean(entry?.blockedUntil && entry.blockedUntil > new Date());
};

export const recordRateLimitFailure = async (
  key: string,
  maximumAttempts: number,
  windowMinutes: number,
  blockMinutes: number
) => {
  await ensureAuthIndexes();
  const { rateLimits } = await getCollections();
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const existing = await rateLimits.findOne({ key });
  const count = existing && existing.windowStartedAt > windowStart
    ? existing.count + 1
    : 1;

  await rateLimits.updateOne(
    { key },
    {
      $set: {
        count,
        windowStartedAt:
          existing && existing.windowStartedAt > windowStart
            ? existing.windowStartedAt
            : now,
        blockedUntil:
          count >= maximumAttempts
            ? new Date(now.getTime() + blockMinutes * 60_000)
            : undefined,
        expiresAt: new Date(now.getTime() + Math.max(windowMinutes, blockMinutes) * 2 * 60_000),
      },
    },
    { upsert: true }
  );
};

export const clearRateLimit = async (key: string) => {
  const { rateLimits } = await getCollections();
  await rateLimits.deleteOne({ key });
};

export const createSessionResponse = async (
  user: UserDocument,
  response: NextResponse
) => {
  const token = await createSessionToken({
    sub: user._id!.toHexString(),
    username: user.username,
    role: user.role,
    authVersion: user.authVersion || 0,
  });

  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
};

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
};

export const getAuthenticatedUser = async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session || !ObjectId.isValid(session.sub)) return null;

  const { users } = await getCollections();
  const user = await users.findOne({ _id: new ObjectId(session.sub) });
  if (!user || !user.isActive || (user.authVersion || 0) !== session.authVersion) {
    return null;
  }
  return user;
};

export const requireAuthenticatedUser = async () => {
  const user = await getAuthenticatedUser();
  if (user) return { user, response: null };
  return {
    user: null,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
};

export const getUsersCollection = async () => {
  await ensureAuthIndexes();
  return (await getCollections()).users;
};
