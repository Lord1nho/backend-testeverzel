import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { authorizeRole } from "../../shared/middlewares/authorize-role.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import { payReservationController } from "./payments.controller.js";
import { payReservationBodySchema } from "./payments.schemas.js";

export const paymentsRoutes = Router();

paymentsRoutes.use(authenticate, authorizeRole("CUSTOMER"));

paymentsRoutes.post("/", validateRequest({ body: payReservationBodySchema }), payReservationController);
