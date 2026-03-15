import amqp, { Channel, Connection } from 'amqplib';
import { createLogger } from '../../../../shared/utils/logger';
import { DomainEvent } from '../../../../shared/types/events';
import { withRetry, RETRY_CONFIGS } from '../../../../shared/utils/retry';

const logger = createLogger('rabbitmq');

let connection: Connection | null = null;
let channel: Channel | null = null;

const EXCHANGE = 'rideflow.events';
const EXCHANGE_TYPE = 'topic';

export async function connectRabbitMQ(): Promise<Channel> {
  const url = process.env.RABBITMQ_URL || 'amqp://rideflow:rideflow123@localhost:5672';

  await withRetry(
    async () => {
      connection = await amqp.connect(url);
      channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, { durable: true });

      connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err.message });
        connection = null;
        channel = null;
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, will reconnect on next publish');
        connection = null;
        channel = null;
      });

      logger.info('Connected to RabbitMQ', { exchange: EXCHANGE });
    },
    RETRY_CONFIGS.messageQueue,
    'rabbitmq-connect',
  );

  return channel!;
}

export async function publishEvent<T>(event: DomainEvent<T>): Promise<void> {
  if (!channel) {
    await connectRabbitMQ();
  }

  const routingKey = `${event.aggregateType.toLowerCase()}.${event.eventType.toLowerCase()}`;
  const content = Buffer.from(JSON.stringify(event));

  channel!.publish(EXCHANGE, routingKey, content, {
    persistent: true,
    contentType: 'application/json',
    headers: {
      'x-event-id': event.eventId,
      'x-event-version': event.version,
      'x-correlation-id': event.correlationId,
    },
  });

  logger.info('Event published', {
    eventType: event.eventType,
    aggregateId: event.aggregateId,
    routingKey,
    correlationId: event.correlationId,
  });
}

export async function consumeQueue(
  queueName: string,
  routingKey: string,
  handler: (event: DomainEvent<any>) => Promise<void>,
  deadLetterQueue = 'dead.letter',
): Promise<void> {
  if (!channel) {
    await connectRabbitMQ();
  }

  await channel!.assertQueue(queueName, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': deadLetterQueue,
      'x-message-ttl': 60000, // mensagens expiram em 60s se não processadas
    },
  });

  await channel!.bindQueue(queueName, EXCHANGE, routingKey);
  channel!.prefetch(10); // processa até 10 mensagens por vez

  channel!.consume(queueName, async (msg) => {
    if (!msg) return;

    const maxRetries = 3;
    const retryCount = (msg.properties.headers?.['x-retry-count'] as number) || 0;

    try {
      const event: DomainEvent<any> = JSON.parse(msg.content.toString());
      await handler(event);
      channel!.ack(msg);
    } catch (err) {
      logger.error('Failed to process message', {
        queue: queueName,
        retryCount,
        error: (err as Error).message,
      });

      if (retryCount < maxRetries) {
        // Requeue com contador de tentativas incrementado
        channel!.nack(msg, false, false);
        channel!.publish('', queueName, msg.content, {
          ...msg.properties,
          headers: {
            ...msg.properties.headers,
            'x-retry-count': retryCount + 1,
          },
        });
      } else {
        // Esgotou tentativas → dead letter
        logger.error('Message sent to dead letter queue', { queue: queueName, retryCount });
        channel!.nack(msg, false, false);
      }
    }
  });

  logger.info('Consumer started', { queue: queueName, routingKey });
}
