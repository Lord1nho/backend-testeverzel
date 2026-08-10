import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { authorizeRole } from "../../shared/middlewares/authorize-role.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import { createShareLinkController, getTicketController, listMyTicketsController } from "./tickets.controller.js";
import { ticketIdParamSchema } from "./tickets.schemas.js";

export const ticketsRoutes = Router();

ticketsRoutes.use(authenticate, authorizeRole("CUSTOMER"));

ticketsRoutes.get("/", listMyTicketsController);
ticketsRoutes.get("/:id", validateRequest({ params: ticketIdParamSchema }), getTicketController);
ticketsRoutes.post("/:id/share", validateRequest({ params: ticketIdParamSchema }), createShareLinkController);
