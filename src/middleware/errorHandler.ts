import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (res.headersSent) {
    return _next(err);
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const errorMessage = err instanceof Error ? err.message : String(err);

  const logPayload = {
    event: 'unhandled_error',
    path: req.originalUrl,
    method: req.method,
    statusCode,
    error: errorMessage,
    ...(err instanceof AppError ? { context: err.context } : {}),
  };

  if (isClientError) {
    logger.warn(logPayload);
  } else {
    logger.error(logPayload);
  }

  res.status(statusCode).json({
    error: errorMessage,
    ...(err instanceof AppError && err.context ? { details: err.context } : {}),
  });
}
