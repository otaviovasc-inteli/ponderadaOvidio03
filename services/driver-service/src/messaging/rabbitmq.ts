import amqp, { Channel, Connection } from 'amqplib';
import { createLogger } from '../../../../shared/utils/logger';
import { DomainEvent } from '../../../../shared/types/events';
import { withRetry, RETRY_CONFIGS } from '../../../../shared/utils/retry';

const logger = createLogger('driver-service:rabbitmq');

let connection: Connection | null = null;
let channel: Channel | null = null;
const EXCHANGE = 'rideflow.events';

export async function connectRabbitMQ(): Promise<Channel> {
  const url = process.env.RABBITMQ_URL || 'amqp://rideflow:rideflow123@localhost:5672';

  await withRetry(async () => {
    connection = await amqp.connect(url);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    connection!.on('error', () => { connection = null; channel = null; });
    connection!.on('close', () => { connection = null; channel = null; });
    logger.info('Connected to RabbitMQ');
  }, RETRY_CONFIGS.messageQueue, 'rabbitmq-connect');

  return channel!;
}

export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  if (!channel) await connectRabbitMQ();
  const routingKey = `${event.aggregateType.toLowerCase()}.${event.eventType.toLowerCase()}`;
  channel!.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: 'application/json',
    headers: { 'x-event-id': event.eventId, 'x-correlation-id': event.correlationId },
  });
  logger.info('Event published', { eventType: event.eventType, aggregateId: event.aggregateId });
}
