import amqp, { Channel, Connection } from 'amqplib';
import axios from 'axios';
import { createLogger } from '../../../shared/utils/logger';
import { createEvent } from '../../../shared/utils/event-factory';
import { withRetry, RETRY_CONFIGS } from '../../../shared/utils/retry';
import {
  DomainEvent,
  EventTypes,
  RideRequestedPayload,
  MatchFoundPayload,
  MatchFailedPayload,
} from '../../../shared/types/events';

const logger = createLogger('matching-service');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rideflow:rideflow123@localhost:5672';
const DRIVER_SERVICE_URL = process.env.DRIVER_SERVICE_URL || 'http://localhost:3002';
const MATCHING_TIMEOUT_MS = parseInt(process.env.MATCHING_TIMEOUT_MS || '30000', 10);
const EXCHANGE = 'rideflow.events';

let connection: Connection | null = null;
let channel: Channel | null = null;

// Algoritmo de Haversine para distância em km entre dois pontos
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function findBestDriver(pickupLat: number, pickupLng: number) {
  const response = await axios.get(`${DRIVER_SERVICE_URL}/drivers`, {
    timeout: 10000,
  });

  const drivers: any[] = response.data.data || [];

  if (drivers.length === 0) return null;

  // Ordena por distância do ponto de pickup + penaliza rating baixo
  const scored = drivers
    .filter((d) => d.current_lat && d.current_lng)
    .map((d) => ({
      ...d,
      distanceKm: haversineDistance(pickupLat, pickupLng, d.current_lat, d.current_lng),
    }))
    .sort((a, b) => {
      // Score: distância (peso 70%) + rating invertido (peso 30%)
      const scoreA = a.distanceKm * 0.7 + (5 - a.rating) * 0.3;
      const scoreB = b.distanceKm * 0.7 + (5 - b.rating) * 0.3;
      return scoreA - scoreB;
    });

  return scored[0] || null;
}

async function publishEvent<T>(event: DomainEvent<T>) {
  if (!channel) return;
  const routingKey = `${event.aggregateType.toLowerCase()}.${event.eventType.toLowerCase()}`;
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: 'application/json',
  });
  logger.info('Event published', { eventType: event.eventType, aggregateId: event.aggregateId });
}

// Handler principal: recebe RideRequested e tenta encontrar um motorista
async function handleRideRequested(event: DomainEvent<RideRequestedPayload>) {
  const { aggregateId: rideId, payload, correlationId } = event;
  logger.info('Matching started', { rideId, correlationId });

  const startTime = Date.now();

  try {
    const driver = await withRetry(
      async () => {
        const found = await findBestDriver(payload.pickup.lat, payload.pickup.lng);
        if (!found) throw new Error('No drivers available');
        return found;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 3000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      },
      'find-driver',
    );

    const elapsedMs = Date.now() - startTime;
    const etaSeconds = Math.round((driver.distanceKm / 30) * 3600); // velocidade média 30 km/h

    logger.info('Match found', {
      rideId,
      driverId: driver.id,
      distanceKm: driver.distanceKm.toFixed(2),
      etaSeconds,
      elapsedMs,
      correlationId,
    });

    await publishEvent(
      createEvent<MatchFoundPayload>(
        EventTypes.MATCH_FOUND, rideId, 'Ride',
        {
          rideId,
          driverId: driver.id,
          driverName: driver.name,
          driverLat: driver.current_lat,
          driverLng: driver.current_lng,
          etaSeconds,
        },
        { correlationId, causationId: event.eventId, source: 'matching-service' },
      ),
    );
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const reason = (err as Error).message;

    logger.warn('Matching failed', { rideId, reason, elapsedMs, correlationId });

    await publishEvent(
      createEvent<MatchFailedPayload>(
        EventTypes.MATCH_FAILED, rideId, 'Ride',
        { rideId, reason },
        { correlationId, causationId: event.eventId, source: 'matching-service' },
      ),
    );
  }
}

async function start() {
  await withRetry(async () => {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    logger.info('Connected to RabbitMQ');
  }, RETRY_CONFIGS.messageQueue, 'connect-rabbitmq');

  // Fila de entrada para eventos RideRequested
  const QUEUE = 'matching.ride-requested';
  await channel!.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': 'dead.letter',
      'x-message-ttl': MATCHING_TIMEOUT_MS,
    },
  });
  await channel!.bindQueue(QUEUE, EXCHANGE, `ride.${EventTypes.RIDE_REQUESTED.toLowerCase()}`);
  channel!.prefetch(5);

  channel!.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const event: DomainEvent<RideRequestedPayload> = JSON.parse(msg.content.toString());
      await handleRideRequested(event);
      channel!.ack(msg);
    } catch (err) {
      logger.error('Failed to process RideRequested', { error: (err as Error).message });
      channel!.nack(msg, false, false);
    }
  });

  logger.info('Matching service listening', { queue: QUEUE, timeoutMs: MATCHING_TIMEOUT_MS });
}

start().catch((err) => {
  logger.error('Failed to start matching service', { error: err.message });
  process.exit(1);
});
