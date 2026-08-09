import { Router } from "express";

import { authRoutes } from "./auth/auth.routes.js";
import { catalogRoutes } from "./catalog/catalog.routes.js";
import { eventsRoutes } from "./events/events.routes.js";
import { publicEventsRoutes } from "./events/events.public.routes.js";
import { gateRoutes } from "./gate/gate.routes.js";
import { paymentsRoutes } from "./payments/payments.routes.js";
import { reservationsRoutes } from "./reservations/reservations.routes.js";
import { ticketsRoutes } from "./tickets/tickets.routes.js";

export const apiRoutes = Router();

apiRoutes.use("/auth", authRoutes);
apiRoutes.use("/catalog", catalogRoutes);
apiRoutes.use("/public/events", publicEventsRoutes);
apiRoutes.use("/events", eventsRoutes);
apiRoutes.use("/reservations", reservationsRoutes);
apiRoutes.use("/payments", paymentsRoutes);
apiRoutes.use("/tickets", ticketsRoutes);
apiRoutes.use("/gate", gateRoutes);
