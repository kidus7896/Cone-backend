import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, ZodTypeAny, z } from "zod";

// Error body shape from openapi.yaml: { error: { code, message, fields } }
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, "validation_failed", message, fields);
export const unauthorized = (message = "Sign in required") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "Not allowed") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "Not found") =>
  new AppError(404, "not_found", message);
export const tooMany = (message = "Too many attempts. Try again later.") =>
  new AppError(429, "rate_limited", message);

export function parseBody<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw badRequest("Some fields are invalid", zodFields(result.error));
}

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

// Express 4 does not catch rejected promises, so wrap async handlers.
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, fields: err.fields ?? {} },
    });
    return;
  }
  // Never leak internals to clients.
  console.error(err);
  res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong", fields: {} },
  });
}
