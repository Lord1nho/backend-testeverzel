import type { RequestHandler } from "express";

import * as paymentsService from "./payments.service.js";
import type { PayReservationBody } from "./payments.schemas.js";

export const payReservationController: RequestHandler = async (request, response) => {
  const result = await paymentsService.payForReservation(request.user!.id, request.body as PayReservationBody);
  response.status(200).json(result);
};
