import { Router } from "express";

import { validateRequest } from "../../shared/middlewares/validate-request.js";
import { getSharedTicketController } from "./tickets.public.controller.js";
import { shareTokenParamSchema } from "./tickets.schemas.js";

// UC15 - visualizacao do ingresso compartilhado, sem autenticacao (mesmo
// padrao de events.public.routes.ts). O token e o segredo -- ver
// tickets.service.ts (getSharedTicket) e tickets.repository.ts
// (findByShareTokenHash).
export const publicTicketsRoutes = Router();

publicTicketsRoutes.get("/:token", validateRequest({ params: shareTokenParamSchema }), getSharedTicketController);
