import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import { loginController, meController } from "./auth.controller.js";
import { loginBodySchema } from "./auth.schemas.js";

export const authRoutes = Router();

authRoutes.post("/login", validateRequest({ body: loginBodySchema }), loginController);
authRoutes.get("/me", authenticate, meController);
