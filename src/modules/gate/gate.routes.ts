import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { authorizeRole } from "../../shared/middlewares/authorize-role.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import { validateTicketController } from "./gate.controller.js";
import { validateTicketBodySchema } from "./gate.schemas.js";

export const gateRoutes = Router();

gateRoutes.use(authenticate, authorizeRole("GATE"));

gateRoutes.post("/validate", validateRequest({ body: validateTicketBodySchema }), validateTicketController);
