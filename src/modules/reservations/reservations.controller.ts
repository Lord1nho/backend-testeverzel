import type { RequestHandler } from "express";

import * as reservationsService from "./reservations.service.js";
import type { CreateReservationBody, ReservationIdParam } from "./reservations.schemas.js";

export const createReservationController: RequestHandler = async (request, response) => {
  const reservation = await reservationsService.createReservation(
    request.user!.id,
    request.body as CreateReservationBody,
  );
  response.status(201).json({ reservation });
};

export const getReservationController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as ReservationIdParam;
  const reservation = await reservationsService.getReservationById(request.user!.id, id);
  response.status(200).json({ reservation });
};

export const cancelReservationController: RequestHandler = async (request, response) => {
  const { id } = request.params as unknown as ReservationIdParam;
  const reservation = await reservationsService.cancelReservation(request.user!.id, id);
  response.status(200).json({ reservation });
};
