import { randomUUID } from 'crypto';
import { query, withTransaction } from './db/database';
import { publishEvent } from './messaging/rabbitmq';
import { createEvent } from '../../../shared/utils/event-factory';
import { createLogger } from '../../../shared/utils/logger';
import {
  RideNotFoundError,
  RideAlreadyActiveError,
  InvalidRideStatusTransitionError,
} from '../../../shared/errors/base-error';
import {
  EventTypes,
  RideRequestedPayload,
  RideAcceptedPayload,
  RideStartedPayload,
  RideCompletedPayload,
  RideCancelledPayload,
} from '../../../shared/types/events';
import { RideStatus } from '../../../shared/types/api';

const logger = createLogger('ride-service');

// Máquina de estados: transições permitidas
const ALLOWED_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  requested: ['matching', 'cancelled'],
  matching: ['accepted', 'cancelled'],
  accepted: ['driver_en_route', 'cancelled'],
  driver_en_route: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

interface RequestRideInput {
  passengerId: string;
  pickup: { lat: number; lng: number; address: string };
  destination: { lat: number; lng: number; address: string };
  correlationId?: string;
}

function estimateDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  // Fórmula de Haversine para distância em km
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimatePrice(distanceKm: number): number {
  const BASE_FARE = 5.0;
  const PER_KM = 2.5;
  return Math.round((BASE_FARE + distanceKm * PER_KM) * 100) / 100;
}

export async function requestRide(input: RequestRideInput) {
  // Verifica se passageiro já tem corrida ativa
  const activeRides = await query(
    `SELECT id FROM rides WHERE passenger_id = $1 AND status NOT IN ('completed', 'cancelled')`,
    [input.passengerId],
  );

  if (activeRides.length > 0) {
    throw new RideAlreadyActiveError(input.passengerId);
  }

  const distanceKm = estimateDistance(
    input.pickup.lat, input.pickup.lng,
    input.destination.lat, input.destination.lng,
  );
  const estimatedPrice = estimatePrice(distanceKm);
  const correlationId = input.correlationId || randomUUID();

  const ride = await withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO rides (
        id, passenger_id, status,
        pickup_lat, pickup_lng, pickup_address,
        destination_lat, destination_lng, destination_address,
        estimated_distance_km, estimated_price, correlation_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        randomUUID(), input.passengerId, 'requested',
        input.pickup.lat, input.pickup.lng, input.pickup.address,
        input.destination.lat, input.destination.lng, input.destination.address,
        distanceKm, estimatedPrice, correlationId,
      ],
    );
    return result.rows[0];
  });

  const event = createEvent<RideRequestedPayload>(
    EventTypes.RIDE_REQUESTED,
    ride.id,
    'Ride',
    {
      passengerId: input.passengerId,
      pickup: input.pickup,
      destination: input.destination,
      estimatedDistanceKm: distanceKm,
      estimatedPrice,
    },
    { correlationId, source: 'ride-service' },
  );

  await publishEvent(event);

  logger.info('Ride requested', { rideId: ride.id, passengerId: input.passengerId, correlationId });
  return ride;
}

export async function getRideById(rideId: string) {
  const rows = await query('SELECT * FROM rides WHERE id = $1', [rideId]);
  if (rows.length === 0) throw new RideNotFoundError(rideId);
  return rows[0];
}

export async function updateRideStatus(
  rideId: string,
  newStatus: RideStatus,
  extraFields: Record<string, any> = {},
) {
  const rows = await query('SELECT * FROM rides WHERE id = $1', [rideId]);
  if (rows.length === 0) throw new RideNotFoundError(rideId);

  const ride = rows[0];
  const currentStatus = ride.status as RideStatus;

  if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw new InvalidRideStatusTransitionError(currentStatus, newStatus);
  }

  const sets: string[] = ['status = $2', 'updated_at = NOW()'];
  const values: any[] = [rideId, newStatus];
  let idx = 3;

  for (const [key, val] of Object.entries(extraFields)) {
    sets.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }

  const result = await query(
    `UPDATE rides SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    values,
  );
  return result[0];
}

export async function acceptRide(rideId: string, driverId: string, correlationId?: string) {
  const ride = await updateRideStatus(rideId, 'accepted', {
    driver_id: driverId,
    accepted_at: 'NOW()',
  });

  await publishEvent(
    createEvent<RideAcceptedPayload>(EventTypes.RIDE_ACCEPTED, rideId, 'Ride',
      { rideId, driverId, acceptedAt: new Date().toISOString() },
      { correlationId: correlationId || ride.correlation_id, source: 'ride-service' },
    ),
  );

  return ride;
}

export async function startRide(rideId: string, correlationId?: string) {
  const ride = await updateRideStatus(rideId, 'in_progress', { started_at: 'NOW()' });

  await publishEvent(
    createEvent<RideStartedPayload>(EventTypes.RIDE_STARTED, rideId, 'Ride',
      { rideId, startedAt: new Date().toISOString() },
      { correlationId: correlationId || ride.correlation_id, source: 'ride-service' },
    ),
  );

  return ride;
}

export async function completeRide(rideId: string, correlationId?: string) {
  const ride = await updateRideStatus(rideId, 'completed', { completed_at: 'NOW()' });

  await publishEvent(
    createEvent<RideCompletedPayload>(EventTypes.RIDE_COMPLETED, rideId, 'Ride',
      {
        rideId,
        driverId: ride.driver_id,
        passengerId: ride.passenger_id,
        finalPrice: ride.final_price || ride.estimated_price,
        completedAt: new Date().toISOString(),
      },
      { correlationId: correlationId || ride.correlation_id, source: 'ride-service' },
    ),
  );

  return ride;
}

export async function cancelRide(rideId: string, cancelledBy: 'passenger' | 'driver' | 'system', reason: string, correlationId?: string) {
  const ride = await updateRideStatus(rideId, 'cancelled', {
    cancelled_at: 'NOW()',
    cancellation_reason: reason,
  });

  await publishEvent(
    createEvent<RideCancelledPayload>(EventTypes.RIDE_CANCELLED, rideId, 'Ride',
      { rideId, cancelledBy, reason },
      { correlationId: correlationId || ride.correlation_id, source: 'ride-service' },
    ),
  );

  return ride;
}
