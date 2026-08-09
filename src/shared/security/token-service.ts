import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";

type JwtPayload = {
  sub: string;
  role: string;
};

export const ACCESS_TOKEN_COOKIE_NAME = "access_token";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 1 dia
export const ACCESS_TOKEN_MAX_AGE_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

export function signAccessToken(payload: JwtPayload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
