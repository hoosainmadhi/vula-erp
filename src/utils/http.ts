import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import { logger } from './logger.js';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

interface StatusError extends Error {
  status?: number;
  code?: string;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const candidate = err as StatusError | undefined;
  if (candidate && typeof candidate.status === 'number') {
    res
      .status(candidate.status)
      .json(
        candidate.code
          ? { error: candidate.message, code: candidate.code }
          : { error: candidate.message },
      );
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('Unhandled server error', { error: message, stack });
  res
    .status(500)
    .json({ error: config.nodeEnv === 'production' ? 'Internal server error' : message });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
