import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

export const AUTH_COOKIE_NAME = "gopalam_session";
export const SESSION_MAX_AGE_SECONDS = 10 * 60 * 60;

export type SessionPayload = {
  sub: string;
  username: string;
  role: string;
  authVersion: number;
  iat?: number;
  exp?: number;
};

const getAuthSecret = () => {
  const secret =
    process.env.AUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "gopalam-local-development-only-auth-secret"
      : "");
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(secret);
};

type NewSessionPayload = {
  sub: string;
  username: string;
  role: string;
  authVersion: number;
};

export const createSessionToken = (payload: NewSessionPayload) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecret());

export const verifySessionToken = async (token: string) => {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), {
      algorithms: ["HS256"],
    });

    if (
      !payload.sub ||
      typeof payload.username !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.authVersion !== "number"
    ) {
      return null;
    }

    return payload as SessionPayload;
  } catch {
    return null;
  }
};
