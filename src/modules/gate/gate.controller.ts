import type { RequestHandler } from "express";

import * as gateService from "./gate.service.js";
import type { ValidateTicketBody } from "./gate.schemas.js";

export const validateTicketController: RequestHandler = async (request, response) => {
  const body = request.body as ValidateTicketBody;
  const result = await gateService.validateTicket({ ...body, gateUserId: request.user!.id });
  response.status(200).json(result);
};
