import { Request, Response, NextFunction } from 'express';
import { BaseError } from '../../../../shared/errors/base-error';
import { createLogger } from '../../../../shared/utils/logger';

const logger = createLogger('api-gateway');

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = String(req.headers['x-request-id'] || 'unknown');

  logger.error('Request error', {
    requestId,
    method: req.method,
    url: req.url,
    errorName: err.name,
    errorMessage: err.message,
    isOperational: err instanceof BaseError ? err.isOperational : false,
  });

  if (err instanceof BaseError && err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        timestamp: new Date().toISOString(),
        requestId,
      },
      metadata: {
        version: 'v1',
        timestamp: new Date().toISOString(),
        requestId,
      },
    });
    return;
  }

  // Erros não esperados: nunca expõe stack trace em produção
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred. Our team has been notified.',
      timestamp: new Date().toISOString(),
      requestId,
    },
    metadata: {
      version: 'v1',
      timestamp: new Date().toISOString(),
      requestId,
    },
  });
}
