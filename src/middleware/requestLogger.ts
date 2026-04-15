import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, {
      event: 'http_request',
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  next();
}
