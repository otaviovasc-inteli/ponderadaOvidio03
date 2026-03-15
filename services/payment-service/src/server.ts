import express from 'express';
import { randomUUID } from 'crypto';
import amqp, { Channel, Connection } from 'amqplib';
import { Pool } from 'pg';
import { createLogger } from '../../../shared/utils/logger';
import { createEvent } from '../../../shared/utils/event-factory';
import { withRetry, RETRY_CONFIGS } from '../../../shared/utils/retry';
import {
  DomainEvent,
  EventTypes,
  RideCompletedPayload,
  RideAcceptedPayload,
  PaymentAuthorizedPayload,
  PaymentCapturedPayload,
  PaymentFailedPayload,
} from '../../../shared/types/events';

const logger = createLogger('payment-service');
const app = express();
const PORT = process.env.PORT || 3003;
const EXCHANGE = 'rideflow.events';

app.use(express.json());

// Pool de conexão com o banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
});

let connection: Connection | null = null;
let channel: Channel | null = null;

async function publishEvent<T>(event: DomainEvent<T>) {
  if (!channel) return;
  const routingKey = `${event.aggregateType.toLowerCase()}.${event.eventType.toLowerCase()}`;
  channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: 'application/json',
  });
  logger.info('Event published', { eventType: event.eventType });
}

// Simula integração com Stripe — em produção chamaria a API real
async function simulateStripeAuthorize(amount: number, _passengerId: string): Promise<{ id: string; status: string }> {
  // Delay simulado da API externa (200-800ms)
  await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 600));

  // Simula falha 5% do tempo para demonstrar tratamento de exceção
  if (Math.random() < 0.05) {
    throw new Error('card_declined');
  }

  return { id: `pi_simulated_${randomUUID().replace(/-/g, '')}`, status: 'requires_capture' };
}

async function simulateStripeCapture(transactionId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 300));
  logger.info('Stripe capture simulated', { transactionId });
}

// Autoriza pagamento quando corrida é aceita
async function handleRideAccepted(event: DomainEvent<RideAcceptedPayload>) {
  const { aggregateId: rideId, payload, correlationId } = event;

  const rideRows = await pool.query('SELECT * FROM rides WHERE id = $1', [rideId]);
  if (rideRows.rows.length === 0) {
    logger.warn('Ride not found for payment authorization', { rideId });
    return;
  }

  const ride = rideRows.rows[0];
  const idempotencyKey = `auth-${rideId}`;

  // Idempotência: evita dupla cobrança
  const existing = await pool.query(
    'SELECT id FROM payments WHERE idempotency_key = $1',
    [idempotencyKey],
  );
  if (existing.rows.length > 0) {
    logger.warn('Payment already authorized (idempotent)', { rideId, idempotencyKey });
    return;
  }

  const paymentId = randomUUID();

  try {
    const stripeResult = await withRetry(
      () => simulateStripeAuthorize(ride.estimated_price, ride.passenger_id),
      RETRY_CONFIGS.externalAPI,
      'stripe-authorize',
    );

    await pool.query(
      `INSERT INTO payments (id, ride_id, passenger_id, amount, currency, status, external_transaction_id, authorized_at, idempotency_key)
       VALUES ($1, $2, $3, $4, 'BRL', 'authorized', $5, NOW(), $6)`,
      [paymentId, rideId, ride.passenger_id, ride.estimated_price, stripeResult.id, idempotencyKey],
    );

    await publishEvent(
      createEvent<PaymentAuthorizedPayload>(
        EventTypes.PAYMENT_AUTHORIZED, rideId, 'Ride',
        { rideId, paymentId, amount: ride.estimated_price, authorizedAt: new Date().toISOString() },
        { correlationId, causationId: event.eventId, source: 'payment-service' },
      ),
    );

    logger.info('Payment authorized', { rideId, paymentId, amount: ride.estimated_price });
  } catch (err) {
    logger.error('Payment authorization failed', { rideId, error: (err as Error).message });

    await pool.query(
      `INSERT INTO payments (id, ride_id, passenger_id, amount, currency, status, failure_reason, idempotency_key)
       VALUES ($1, $2, $3, $4, 'BRL', 'failed', $5, $6)`,
      [paymentId, rideId, ride.passenger_id, ride.estimated_price, (err as Error).message, idempotencyKey],
    );

    await publishEvent(
      createEvent<PaymentFailedPayload>(
        EventTypes.PAYMENT_FAILED, rideId, 'Ride',
        { rideId, paymentId, reason: (err as Error).message, failedAt: new Date().toISOString() },
        { correlationId, causationId: event.eventId, source: 'payment-service' },
      ),
    );
  }
}

// Captura pagamento quando corrida é concluída
async function handleRideCompleted(event: DomainEvent<RideCompletedPayload>) {
  const { aggregateId: rideId, payload, correlationId } = event;

  const paymentRows = await pool.query(
    `SELECT * FROM payments WHERE ride_id = $1 AND status = 'authorized'`,
    [rideId],
  );

  if (paymentRows.rows.length === 0) {
    logger.warn('No authorized payment found for ride completion', { rideId });
    return;
  }

  const payment = paymentRows.rows[0];

  try {
    await simulateStripeCapture(payment.external_transaction_id);

    await pool.query(
      `UPDATE payments SET status = 'captured', captured_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [payment.id],
    );

    // Atualiza preço final na corrida
    await pool.query(
      `UPDATE rides SET final_price = $1, updated_at = NOW() WHERE id = $2`,
      [payload.finalPrice || payment.amount, rideId],
    );

    await publishEvent(
      createEvent<PaymentCapturedPayload>(
        EventTypes.PAYMENT_CAPTURED, rideId, 'Ride',
        { rideId, paymentId: payment.id, amount: payment.amount, capturedAt: new Date().toISOString() },
        { correlationId, causationId: event.eventId, source: 'payment-service' },
      ),
    );

    logger.info('Payment captured', { rideId, paymentId: payment.id, amount: payment.amount });
  } catch (err) {
    logger.error('Payment capture failed', { rideId, error: (err as Error).message });
  }
}

// REST endpoints
app.get('/health', (_req, res) => res.json({ status: 'healthy', service: 'payment-service' }));

app.get('/payments/ride/:rideId', async (req, res) => {
  const rows = await pool.query('SELECT * FROM payments WHERE ride_id = $1 ORDER BY created_at DESC', [req.params.rideId]);
  res.json({ success: true, data: rows.rows });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

async function start() {
  await withRetry(async () => {
    const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rideflow:rideflow123@localhost:5672';
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

    // Fila para RideAccepted → autorizar pagamento
    const Q_ACCEPTED = 'payment.ride-accepted';
    await channel.assertQueue(Q_ACCEPTED, { durable: true, arguments: { 'x-dead-letter-routing-key': 'dead.letter' } });
    await channel.bindQueue(Q_ACCEPTED, EXCHANGE, `ride.${EventTypes.RIDE_ACCEPTED.toLowerCase()}`);

    // Fila para RideCompleted → capturar pagamento
    const Q_COMPLETED = 'payment.ride-completed';
    await channel.assertQueue(Q_COMPLETED, { durable: true, arguments: { 'x-dead-letter-routing-key': 'dead.letter' } });
    await channel.bindQueue(Q_COMPLETED, EXCHANGE, `ride.${EventTypes.RIDE_COMPLETED.toLowerCase()}`);

    channel.prefetch(5);

    channel.consume(Q_ACCEPTED, async (msg) => {
      if (!msg) return;
      try {
        await handleRideAccepted(JSON.parse(msg.content.toString()));
        channel!.ack(msg);
      } catch (e) { channel!.nack(msg, false, false); }
    });

    channel.consume(Q_COMPLETED, async (msg) => {
      if (!msg) return;
      try {
        await handleRideCompleted(JSON.parse(msg.content.toString()));
        channel!.ack(msg);
      } catch (e) { channel!.nack(msg, false, false); }
    });

    logger.info('Payment service consumers started');
  }, RETRY_CONFIGS.messageQueue, 'connect-rabbitmq');

  app.listen(PORT, () => logger.info('Payment service running', { port: PORT }));
}

start().catch((err) => {
  logger.error('Failed to start payment service', { error: err.message });
  process.exit(1);
});

export default app;
