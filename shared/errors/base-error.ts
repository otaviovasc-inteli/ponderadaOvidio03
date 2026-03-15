// Classe base para todos os erros da plataforma.
// Distingue erros operacionais (esperados, tratáveis) de erros de programação.
export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  // isOperational = true: erro de negócio, retorna pro cliente
  // isOperational = false: bug ou falha de infra, loga e retorna 500 genérico
  abstract readonly isOperational: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
    // stack trace captured automatically by V8
  }
}

// Erros de domínio (regras de negócio)
export class RideNotFoundError extends BaseError {
  readonly statusCode = 404;
  readonly code = 'RIDE_NOT_FOUND';
  readonly isOperational = true;
  constructor(rideId: string) {
    super(`Ride ${rideId} not found`);
  }
}

export class DriverNotFoundError extends BaseError {
  readonly statusCode = 404;
  readonly code = 'DRIVER_NOT_FOUND';
  readonly isOperational = true;
  constructor(driverId: string) {
    super(`Driver ${driverId} not found`);
  }
}

export class DriverNotAvailableError extends BaseError {
  readonly statusCode = 409;
  readonly code = 'DRIVER_NOT_AVAILABLE';
  readonly isOperational = true;
  constructor(driverId: string) {
    super(`Driver ${driverId} is not available`);
  }
}

export class NoDriversAvailableError extends BaseError {
  readonly statusCode = 503;
  readonly code = 'NO_DRIVERS_AVAILABLE';
  readonly isOperational = true;
  constructor() {
    super('No drivers available at the moment. Please try again in a few minutes.');
  }
}

export class RideAlreadyActiveError extends BaseError {
  readonly statusCode = 409;
  readonly code = 'RIDE_ALREADY_ACTIVE';
  readonly isOperational = true;
  constructor(passengerId: string) {
    super(`Passenger ${passengerId} already has an active ride`);
  }
}

export class InvalidRideStatusTransitionError extends BaseError {
  readonly statusCode = 422;
  readonly code = 'INVALID_STATUS_TRANSITION';
  readonly isOperational = true;
  constructor(from: string, to: string) {
    super(`Cannot transition ride from '${from}' to '${to}'`);
  }
}

export class PaymentFailedError extends BaseError {
  readonly statusCode = 402;
  readonly code = 'PAYMENT_FAILED';
  readonly isOperational = true;
  constructor(reason: string) {
    super(`Payment failed: ${reason}`);
  }
}

export class DuplicateRequestError extends BaseError {
  readonly statusCode = 409;
  readonly code = 'DUPLICATE_REQUEST';
  readonly isOperational = true;
  constructor(idempotencyKey: string) {
    super(`Request with idempotency key ${idempotencyKey} already processed`);
  }
}

// Erros de infraestrutura
export class DatabaseConnectionError extends BaseError {
  readonly statusCode = 503;
  readonly code = 'DATABASE_UNAVAILABLE';
  readonly isOperational = false;
  constructor() {
    super('Database connection failed');
  }
}

export class MessageQueueError extends BaseError {
  readonly statusCode = 503;
  readonly code = 'MESSAGE_QUEUE_UNAVAILABLE';
  readonly isOperational = false;
  constructor(details?: string) {
    super(`Message queue error${details ? `: ${details}` : ''}`);
  }
}

export class ExternalServiceError extends BaseError {
  readonly statusCode = 502;
  readonly code = 'EXTERNAL_SERVICE_ERROR';
  readonly isOperational = true;
  constructor(service: string, details?: string) {
    super(`External service '${service}' failed${details ? `: ${details}` : ''}`);
  }
}

export class RequestTimeoutError extends BaseError {
  readonly statusCode = 408;
  readonly code = 'REQUEST_TIMEOUT';
  readonly isOperational = true;
  constructor(operation: string, timeoutMs: number) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`);
  }
}

export class ValidationError extends BaseError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
  readonly isOperational = true;
  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends BaseError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
  readonly isOperational = true;
  constructor(message = 'Unauthorized') {
    super(message);
  }
}

export class ForbiddenError extends BaseError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
  readonly isOperational = true;
  constructor(message = 'Forbidden') {
    super(message);
  }
}
