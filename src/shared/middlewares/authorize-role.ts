import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";

export function authorizeRole(...allowedRoles: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) {
      throw new AppError("Usuario nao autenticado.", 401);
    }

    if (!allowedRoles.includes(request.user.role)) {
      throw new AppError("Usuario sem permissao para acessar este recurso.", 403);
    }

    next();
  };
}
