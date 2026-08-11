import type { RequestHandler } from "express";

import * as gateService from "./gate.service.js";
import type { TicketCodeParam, ValidateTicketBody } from "./gate.schemas.js";

export const validateTicketController: RequestHandler = async (request, response) => {
  const body = request.body as ValidateTicketBody;
  const result = await gateService.validateTicket({ ...body, gateUserId: request.user!.id });
  response.status(200).json(result);
};

export const resolveTicketEventController: RequestHandler = async (request, response) => {
  const { code } = request.params as unknown as TicketCodeParam;
  const event = await gateService.resolveTicketEvent(code);
  response.status(200).json({ event });
};
