// Envelope padrão para todos os eventos de domínio da plataforma
export interface DomainEvent<T = unknown> {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  timestamp: string;
  correlationId: string;
  causationId: string;
  payload: T;
  metadata: {
    userId?: string;
    source: string;
    environment: string;
  };
}

// --- Payloads de cada evento ---

export interface RideRequestedPayload {
  passengerId: string;
  pickup: Location;
  destination: Location;
  estimatedDistanceKm: number;
  estimatedPrice: number;
}

export interface MatchFoundPayload {
  rideId: string;
  driverId: string;
  driverName: string;
  driverLat: number;
  driverLng: number;
  etaSeconds: number;
}

export interface MatchFailedPayload {
  rideId: string;
  reason: string;
}

export interface RideAcceptedPayload {
  rideId: string;
  driverId: string;
  acceptedAt: string;
}

export interface RideStartedPayload {
  rideId: string;
  startedAt: string;
}

export interface RideCompletedPayload {
  rideId: string;
  driverId: string;
  passengerId: string;
  finalPrice: number;
  completedAt: string;
}

export interface RideCancelledPayload {
  rideId: string;
  cancelledBy: 'passenger' | 'driver' | 'system';
  reason: string;
}

export interface PaymentAuthorizedPayload {
  rideId: string;
  paymentId: string;
  amount: number;
  authorizedAt: string;
}

export interface PaymentCapturedPayload {
  rideId: string;
  paymentId: string;
  amount: number;
  capturedAt: string;
}

export interface PaymentFailedPayload {
  rideId: string;
  paymentId: string;
  reason: string;
  failedAt: string;
}

export interface DriverLocationUpdatedPayload {
  driverId: string;
  lat: number;
  lng: number;
  updatedAt: string;
}

// --- Tipos auxiliares ---

export interface Location {
  lat: number;
  lng: number;
  address: string;
}

// Nomes dos eventos (evita strings soltas no código)
export const EventTypes = {
  RIDE_REQUESTED: 'RideRequested',
  RIDE_ACCEPTED: 'RideAccepted',
  RIDE_STARTED: 'RideStarted',
  RIDE_COMPLETED: 'RideCompleted',
  RIDE_CANCELLED: 'RideCancelled',
  MATCH_FOUND: 'MatchFound',
  MATCH_FAILED: 'MatchFailed',
  PAYMENT_AUTHORIZED: 'PaymentAuthorized',
  PAYMENT_CAPTURED: 'PaymentCaptured',
  PAYMENT_FAILED: 'PaymentFailed',
  DRIVER_LOCATION_UPDATED: 'DriverLocationUpdated',
} as const;

// Nomes das filas RabbitMQ
export const Queues = {
  RIDE_EVENTS: 'ride.events',
  DRIVER_EVENTS: 'driver.events',
  PAYMENT_EVENTS: 'payment.events',
  NOTIFICATION_EVENTS: 'notification.events',
  MATCHING_REQUESTS: 'matching.requests',
  DEAD_LETTER: 'dead.letter',
} as const;
