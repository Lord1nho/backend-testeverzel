import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";

export function authorizeRole(...allowedRoles: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) {
      throw new AppError("Usuário não autenticado.", 401);
    }

    if (!allowedRoles.includes(request.user.role)) {
      throw new AppError("Usuário sem permissão para acessar este recurso.", 403);
    }

    next();
  };
}
