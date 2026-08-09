import { Router } from "express";

import { authenticate } from "../../shared/middlewares/authenticate.js";
import { authorizeRole } from "../../shared/middlewares/authorize-role.js";
import { validateRequest } from "../../shared/middlewares/validate-request.js";
import { movieDetailsController, nowPlayingController, searchMoviesController } from "./catalog.controller.js";
import { movieIdParamSchema, nowPlayingQuerySchema, searchMoviesQuerySchema } from "./catalog.schemas.js";

export const catalogRoutes = Router();

catalogRoutes.use(authenticate, authorizeRole("ORGANIZER"));

catalogRoutes.get("/now-playing", validateRequest({ query: nowPlayingQuerySchema }), nowPlayingController);
catalogRoutes.get("/search", validateRequest({ query: searchMoviesQuerySchema }), searchMoviesController);
catalogRoutes.get("/movies/:tmdbId", validateRequest({ params: movieIdParamSchema }), movieDetailsController);
