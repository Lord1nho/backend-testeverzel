import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";

type RequestSchemas = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, _response, next) => {
    if (schemas.body) {
      request.body = schemas.body.parse(request.body);
    }

    if (schemas.params) {
      request.params = schemas.params.parse(request.params) as typeof request.params;
    }

    if (schemas.query) {
      // Express 5 expoe `request.query` como getter sem setter (derivado do
      // parser de query string interno) -- reatribuir direto lanca
      // "Cannot set property query of #<IncomingMessage> which has only a
      // getter". Redefinir a propriedade na instancia contorna isso.
      Object.defineProperty(request, "query", {
        value: schemas.query.parse(request.query),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    next();
  };
}
