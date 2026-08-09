import type { Request, RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";
import { ACCESS_TOKEN_COOKIE_NAME, verifyAccessToken } from "../security/token-service.js";

export type AuthenticatedUser = {
  id: string;
  role: string;
};

function extractToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    return authorization.replace("Bearer ", "");
  }

  const cookieToken = request.cookies?.[ACCESS_TOKEN_COOKIE_NAME];

  return typeof cookieToken === "string" ? cookieToken : undefined;
}

export const authenticate: RequestHandler = (request, _response, next) => {
  const token = extractToken(request);

  if (!token) {
    throw new AppError("Token de autenticacao ausente.", 401);
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new AppError("Token invalido ou expirado.", 401);
  }

  request.user = {
    id: payload.sub,
    role: payload.role,
  };

  next();
};
