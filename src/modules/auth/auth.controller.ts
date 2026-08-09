import type { CookieOptions, RequestHandler } from "express";

import { env } from "../../config/env.js";
import { ACCESS_TOKEN_COOKIE_NAME, ACCESS_TOKEN_MAX_AGE_MS } from "../../shared/security/token-service.js";
import * as authService from "./auth.service.js";
import type { LoginBody } from "./auth.schemas.js";

const accessTokenCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/",
};

export const loginController: RequestHandler = async (request, response) => {
  const { token, user } = await authService.login(request.body as LoginBody);

  response.cookie(ACCESS_TOKEN_COOKIE_NAME, token, {
    ...accessTokenCookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });

  response.status(200).json({ user });
};

export const meController: RequestHandler = async (request, response) => {
  const user = await authService.getMe(request.user!.id);

  response.status(200).json({ user });
};

export const logoutController: RequestHandler = async (_request, response) => {
  response.clearCookie(ACCESS_TOKEN_COOKIE_NAME, accessTokenCookieOptions);

  response.status(200).json({ message: "Logout realizado com sucesso." });
};
