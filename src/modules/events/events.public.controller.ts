import type { RequestHandler } from "express";

import * as eventsService from "./events.service.js";
import type { EventIdParam } from "./events.schemas.js";

export const listPublishedEventsController: RequestHandler = async (_request, response) => {
  const events = await eventsService.listPublishedEvents();
  response.status(200).json({ events });
};

export const getPublishedEventController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  const event = await eventsService.getPublishedEventById(id);
  response.status(200).json({ event });
};

export const getPublishedEventSeatsController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  const seats = await eventsService.getPublishedEventSeats(id);
  response.status(200).json({ seats });
};
