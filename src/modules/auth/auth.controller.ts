import type { RequestHandler } from "express";

import * as authService from "./auth.service.js";
import type { LoginBody } from "./auth.schemas.js";

export const loginController: RequestHandler = async (request, response) => {
  const { token, user } = await authService.login(request.body as LoginBody);

  response.status(200).json({ token, user });
};

export const meController: RequestHandler = async (request, response) => {
  const user = await authService.getMe(request.user!.id);

  response.status(200).json({ user });
};
