import type { AuthenticatedUser } from "../middlewares/authenticate.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
