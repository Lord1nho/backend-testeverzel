import type { RequestHandler } from "express";

import * as eventsService from "./events.service.js";
import type { CreateEventBody, EventIdParam, UpdateEventBody } from "./events.schemas.js";

export const createEventController: RequestHandler = async (request, response) => {
  const event = await eventsService.createEvent(request.user!.id, request.body as CreateEventBody);
  response.status(201).json({ event });
};

export const listEventsController: RequestHandler = async (request, response) => {
  const events = await eventsService.listEvents(request.user!.id);
  response.status(200).json({ events });
};

export const getEventController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  const event = await eventsService.getEventById(id, request.user!.id);
  response.status(200).json({ event });
};

export const getEventSeatsController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  const seats = await eventsService.getEventSeats(id, request.user!.id);
  response.status(200).json({ seats });
};

export const updateEventController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  const event = await eventsService.updateEvent(id, request.user!.id, request.body as UpdateEventBody);
  response.status(200).json({ event });
};

export const publishEventController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  const event = await eventsService.publishEvent(id, request.user!.id);
  response.status(200).json({ event });
};

export const deleteEventController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as EventIdParam;
  await eventsService.deleteEvent(id, request.user!.id);
  response.status(204).send();
};
