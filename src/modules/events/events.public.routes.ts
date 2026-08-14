import { Router } from "express";

import { validateRequest } from "../../shared/middlewares/validate-request.js";
import {
  getPublishedEventController,
  getPublishedEventSeatsController,
  listPublishedEventsController,
} from "./events.public.controller.js";
import { eventIdParamSchema } from "./events.schemas.js";

// Rotas publicas (ator Cliente): sem authenticate/authorizeRole -- UC7, UC8
// e UC9 nao tem "Cliente autenticado" como pre-condicao no caso de uso
// textual (so UC10 - Reservar Ingresso exige). Montada em /api/public/events
// (ver modules/index.ts), separada de /api/events (Organizador).
export const publicEventsRoutes = Router();

publicEventsRoutes.get("/", listPublishedEventsController);
publicEventsRoutes.get("/:id", validateRequest({ params: eventIdParamSchema }), getPublishedEventController);
publicEventsRoutes.get(
  "/:id/seats",
  validateRequest({ params: eventIdParamSchema }),
  getPublishedEventSeatsController,
);
