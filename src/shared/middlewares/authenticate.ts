import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../security/token-service.js";

export type AuthenticatedUser = {
  id: string;
  role: string;
};

export const authenticate: RequestHandler = (request, _response, next) => {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError("Token de autenticacao ausente.", 401);
  }

  const token = authorization.replace("Bearer ", "");
  const payload = verifyAccessToken(token);

  request.user = {
    id: payload.sub,
    role: payload.role,
  };

  next();
};
