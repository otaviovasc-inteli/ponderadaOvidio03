import amqp, { Channel, Connection } from 'amqplib';
import { createLogger } from '../../../shared/utils/logger';
import { withRetry, RETRY_CONFIGS } from '../../../shared/utils/retry';
import { DomainEvent, EventTypes } from '../../../shared/types/events';

const logger = createLogger('notification-service');
const EXCHANGE = 'rideflow.events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rideflow:rideflow123@localhost:5672';

let connection: Connection | null = null;
let channel: Channel | null = null;

// Canais de notificação simulados - em produção seriam integrações reais
// com FCM (push), Twilio (SMS), SendGrid (email)
type NotificationChannel = 'push' | 'sms' | 'email';

interface Notification {
  userId: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

async function sendNotification(n: Notification): Promise<void> {
  // Simula latência de envio externo
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 150));

  logger.info('Notification sent (simulated)', {
    channel: n.channel,
    userId: n.userId,
    title: n.title,
  });
}

// Mapeia cada tipo de evento para as notificações que devem ser enviadas
function buildNotifications(event: DomainEvent<any>): Notification[] {
  const p = event.payload;

  switch (event.eventType) {
    case EventTypes.MATCH_FOUND:
      return [
        {
          userId: p.passengerId || event.aggregateId,
          channel: 'push',
          title: 'Motorista encontrado!',
          body: `${p.driverName} está a caminho. Chegada em ~${p.etaSeconds}s`,
          metadata: { rideId: event.aggregateId, driverId: p.driverId, etaSeconds: p.etaSeconds },
        },
      ];

    case EventTypes.MATCH_FAILED:
      return [
        {
          userId: event.aggregateId,
          channel: 'push',
          title: 'Sem motoristas disponíveis',
          body: 'Não encontramos um motorista no momento. Tente novamente em alguns minutos.',
          metadata: { rideId: event.aggregateId },
        },
      ];

    case EventTypes.RIDE_ACCEPTED:
      return [
        {
          userId: p.passengerId || event.aggregateId,
          channel: 'push',
          title: 'Corrida aceita',
          body: 'O motorista aceitou sua corrida e está a caminho.',
          metadata: { rideId: event.aggregateId },
        },
      ];

    case EventTypes.PAYMENT_AUTHORIZED:
      return [
        {
          userId: event.aggregateId,
          channel: 'push',
          title: 'Pagamento autorizado',
          body: `R$ ${p.amount?.toFixed(2)} pré-autorizado com sucesso.`,
          metadata: { rideId: event.aggregateId, paymentId: p.paymentId },
        },
      ];

    case EventTypes.RIDE_COMPLETED:
      return [
        {
          userId: p.passengerId,
          channel: 'push',
          title: 'Corrida concluída',
          body: `Sua corrida foi concluída. Valor: R$ ${p.finalPrice?.toFixed(2)}`,
          metadata: { rideId: event.aggregateId },
        },
        {
          userId: p.passengerId,
          channel: 'email',
          title: 'Recibo da sua corrida - RideFlow',
          body: `Obrigado por usar o RideFlow! Valor cobrado: R$ ${p.finalPrice?.toFixed(2)}`,
          metadata: { rideId: event.aggregateId },
        },
        {
          userId: p.driverId,
          channel: 'push',
          title: 'Corrida finalizada',
          body: `Corrida concluída. Valor: R$ ${p.finalPrice?.toFixed(2)}`,
          metadata: { rideId: event.aggregateId },
        },
      ];

    case EventTypes.PAYMENT_CAPTURED:
      return [
        {
          userId: event.aggregateId,
          channel: 'email',
          title: 'Pagamento confirmado - RideFlow',
          body: `Seu pagamento de R$ ${p.amount?.toFixed(2)} foi confirmado.`,
          metadata: { rideId: event.aggregateId, paymentId: p.paymentId },
        },
      ];

    case EventTypes.RIDE_CANCELLED:
      return [
        {
          userId: event.aggregateId,
          channel: 'push',
          title: 'Corrida cancelada',
          body: `Sua corrida foi cancelada. Motivo: ${p.reason}`,
          metadata: { rideId: event.aggregateId },
        },
      ];

    case EventTypes.PAYMENT_FAILED:
      return [
        {
          userId: event.aggregateId,
          channel: 'push',
          title: 'Falha no pagamento',
          body: 'Não foi possível processar o pagamento. Verifique seu cartão.',
          metadata: { rideId: event.aggregateId },
        },
        {
          userId: event.aggregateId,
          channel: 'sms',
          title: 'Falha no pagamento - RideFlow',
          body: 'Sua corrida foi cancelada por falha no pagamento. Atualize seu método de pagamento.',
          metadata: { rideId: event.aggregateId },
        },
      ];

    default:
      return [];
  }
}

async function processEvent(event: DomainEvent<any>): Promise<void> {
  const notifications = buildNotifications(event);

  if (notifications.length === 0) {
    logger.debug('No notifications for event', { eventType: event.eventType });
    return;
  }

  // Envia todas as notificações em paralelo
  await Promise.allSettled(
    notifications.map((n) =>
      sendNotification(n).catch((err) => {
        logger.error('Failed to send notification', {
          channel: n.channel,
          userId: n.userId,
          error: (err as Error).message,
        });
      }),
    ),
  );

  logger.info('Notifications dispatched', {
    eventType: event.eventType,
    count: notifications.length,
    correlationId: event.correlationId,
  });
}

async function start() {
  await withRetry(async () => {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    logger.info('Connected to RabbitMQ');
  }, RETRY_CONFIGS.messageQueue, 'connect-rabbitmq');

  // Assina todos os eventos de domínio com wildcard
  const QUEUE = 'notification.all-events';
  await channel!.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-routing-key': 'dead.letter',
      'x-message-ttl': 30000,
    },
  });

  // Subscreve todos os tópicos de domínio relevantes
  const topics = [
    `ride.${EventTypes.MATCH_FOUND.toLowerCase()}`,
    `ride.${EventTypes.MATCH_FAILED.toLowerCase()}`,
    `ride.${EventTypes.RIDE_ACCEPTED.toLowerCase()}`,
    `ride.${EventTypes.RIDE_COMPLETED.toLowerCase()}`,
    `ride.${EventTypes.RIDE_CANCELLED.toLowerCase()}`,
    `ride.${EventTypes.PAYMENT_AUTHORIZED.toLowerCase()}`,
    `ride.${EventTypes.PAYMENT_CAPTURED.toLowerCase()}`,
    `ride.${EventTypes.PAYMENT_FAILED.toLowerCase()}`,
  ];

  for (const topic of topics) {
    await channel!.bindQueue(QUEUE, EXCHANGE, topic);
  }

  channel!.prefetch(20);

  channel!.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      const event: DomainEvent<any> = JSON.parse(msg.content.toString());
      await processEvent(event);
      channel!.ack(msg);
    } catch (err) {
      logger.error('Failed to process notification event', { error: (err as Error).message });
      channel!.nack(msg, false, false);
    }
  });

  logger.info('Notification service listening', { queue: QUEUE, topics: topics.length });
}

start().catch((err) => {
  logger.error('Failed to start notification service', { error: err.message });
  process.exit(1);
});
