import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { authorizeRole } from "../../shared/middlewares/authorize-role.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import {
  cancelReservationController,
  createReservationController,
  getReservationController,
} from "./reservations.controller.js";
import { createReservationBodySchema, reservationIdParamSchema } from "./reservations.schemas.js";

export const reservationsRoutes = Router();

reservationsRoutes.use(authenticate, authorizeRole("CUSTOMER"));

reservationsRoutes.post("/", validateRequest({ body: createReservationBodySchema }), createReservationController);
reservationsRoutes.get(
  "/:id",
  validateRequest({ params: reservationIdParamSchema }),
  getReservationController,
);
reservationsRoutes.post(
  "/:id/cancel",
  validateRequest({ params: reservationIdParamSchema }),
  cancelReservationController,
);
