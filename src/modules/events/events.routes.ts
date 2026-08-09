import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { authorizeRole } from "../../shared/middlewares/authorize-role.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import {
  createEventController,
  deleteEventController,
  getEventController,
  getEventSeatsController,
  listEventsController,
  publishEventController,
  updateEventController,
} from "./events.controller.js";
import { createEventBodySchema, eventIdParamSchema, updateEventBodySchema } from "./events.schemas.js";

export const eventsRoutes = Router();

eventsRoutes.use(authenticate, authorizeRole("ORGANIZER"));

eventsRoutes.post("/", validateRequest({ body: createEventBodySchema }), createEventController);
eventsRoutes.get("/", listEventsController);
eventsRoutes.get("/:id", validateRequest({ params: eventIdParamSchema }), getEventController);
eventsRoutes.get("/:id/seats", validateRequest({ params: eventIdParamSchema }), getEventSeatsController);
eventsRoutes.patch(
  "/:id",
  validateRequest({ params: eventIdParamSchema, body: updateEventBodySchema }),
  updateEventController,
);
eventsRoutes.delete("/:id", validateRequest({ params: eventIdParamSchema }), deleteEventController);
eventsRoutes.post("/:id/publish", validateRequest({ params: eventIdParamSchema }), publishEventController);
