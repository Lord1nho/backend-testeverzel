import type { RequestHandler } from "express";

import * as ticketsService from "./tickets.service.js";
import type { ShareTokenParam } from "./tickets.schemas.js";

export const getSharedTicketController: RequestHandler = async (request, response) => {
  const { token } = request.params as unknown as ShareTokenParam;
  const ticket = await ticketsService.getSharedTicket(token);
  response.status(200).json({ ticket });
};
