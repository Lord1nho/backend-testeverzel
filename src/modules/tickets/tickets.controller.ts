import type { RequestHandler } from "express";

import * as ticketsService from "./tickets.service.js";
import type { TicketIdParam } from "./tickets.schemas.js";

export const listMyTicketsController: RequestHandler = async (request, response) => {
  const tickets = await ticketsService.listMyTickets(request.user!.id);
  response.status(200).json({ tickets });
};

export const getTicketController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as TicketIdParam;
  const ticket = await ticketsService.getTicketById(request.user!.id, id);
  response.status(200).json({ ticket });
};

export const createShareLinkController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as TicketIdParam;
  const shareLink = await ticketsService.createShareLink(request.user!.id, id);
  response.status(201).json({ shareLink });
};
