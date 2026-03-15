import http from 'http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import amqp, { Channel, Connection } from 'amqplib';
import { createLogger } from '../../../shared/utils/logger';
import { withRetry, RETRY_CONFIGS } from '../../../shared/utils/retry';
import { DomainEvent, EventTypes, DriverLocationUpdatedPayload } from '../../../shared/types/events';

const logger = createLogger('tracking-service');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3004;
const EXCHANGE = 'rideflow.events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rideflow:rideflow123@localhost:5672';

// Socket.io para rastreamento em tempo real
const io = new SocketServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 10000,
  pingInterval: 5000,
});

// Mapa em memória: driverId → última localização conhecida
const driverLocations = new Map<string, { lat: number; lng: number; updatedAt: string }>();

// Mapa: rideId → socketRoom
function getRideRoom(rideId: string) {
  return `ride:${rideId}`;
}

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  // Cliente se inscreve numa corrida específica para receber atualizações
  socket.on('subscribe:ride', (rideId: string) => {
    socket.join(getRideRoom(rideId));
    logger.info('Client subscribed to ride', { socketId: socket.id, rideId });

    // Envia última localização conhecida do motorista imediatamente (se houver)
    socket.emit('tracking:subscribed', { rideId, message: 'Subscribed to ride tracking' });
  });

  socket.on('unsubscribe:ride', (rideId: string) => {
    socket.leave(getRideRoom(rideId));
    logger.info('Client unsubscribed from ride', { socketId: socket.id, rideId });
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
});

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'tracking-service',
    connectedClients: io.engine.clientsCount,
    trackedDrivers: driverLocations.size,
    timestamp: new Date().toISOString(),
  });
});

// REST endpoint para consultar última localização de um motorista
app.get('/tracking/driver/:driverId', (req, res) => {
  const location = driverLocations.get(req.params.driverId);
  if (!location) {
    return res.status(404).json({ success: false, error: { code: 'LOCATION_NOT_FOUND', message: 'No location data for this driver' } });
  }
  return res.json({ success: true, data: { driverId: req.params.driverId, ...location } });
});

let connection: Connection | null = null;
let channel: Channel | null = null;

async function start() {
  await withRetry(async () => {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    logger.info('Connected to RabbitMQ');
  }, RETRY_CONFIGS.messageQueue, 'connect-rabbitmq');

  const QUEUE = 'tracking.driver-location';
  await channel!.assertQueue(QUEUE, {
    durable: false, // localização é efêmera, não precisa persistir
    arguments: { 'x-message-ttl': 5000 }, // 5s TTL — localização velha não tem valor
  });
  await channel!.bindQueue(QUEUE, EXCHANGE, `driver.${EventTypes.DRIVER_LOCATION_UPDATED.toLowerCase()}`);

  // Também ouve eventos de corrida para broadcast de estado
  const RIDE_QUEUE = 'tracking.ride-events';
  await channel!.assertQueue(RIDE_QUEUE, { durable: true });
  for (const eventType of [EventTypes.MATCH_FOUND, EventTypes.RIDE_ACCEPTED, EventTypes.RIDE_STARTED, EventTypes.RIDE_COMPLETED, EventTypes.RIDE_CANCELLED]) {
    await channel!.bindQueue(RIDE_QUEUE, EXCHANGE, `ride.${eventType.toLowerCase()}`);
  }

  channel!.prefetch(50); // localização pode ter alta frequência

  // Consome atualizações de localização
  channel!.consume(QUEUE, (msg) => {
    if (!msg) return;
    try {
      const event: DomainEvent<DriverLocationUpdatedPayload> = JSON.parse(msg.content.toString());
      const { driverId, lat, lng, updatedAt } = event.payload;

      // Atualiza cache local
      driverLocations.set(driverId, { lat, lng, updatedAt });

      // Emite para todos os clientes inscritos nesta corrida (será filtrado client-side)
      // Em produção, teríamos mapeamento driverId → activeRideId
      io.emit('driver:location', { driverId, lat, lng, updatedAt, correlationId: event.correlationId });

      channel!.ack(msg);
    } catch (err) {
      logger.error('Failed to process location update', { error: (err as Error).message });
      channel!.nack(msg, false, false);
    }
  });

  // Consome eventos de corrida e emite para clientes inscritos
  channel!.consume(RIDE_QUEUE, (msg) => {
    if (!msg) return;
    try {
      const event: DomainEvent<any> = JSON.parse(msg.content.toString());
      const rideId = event.aggregateId;

      // Emite evento de status para a sala da corrida
      io.to(getRideRoom(rideId)).emit('ride:status', {
        rideId,
        eventType: event.eventType,
        payload: event.payload,
        timestamp: event.timestamp,
      });

      logger.info('Ride status emitted to clients', { rideId, eventType: event.eventType });
      channel!.ack(msg);
    } catch (err) {
      logger.error('Failed to process ride event', { error: (err as Error).message });
      channel!.nack(msg, false, false);
    }
  });

  server.listen(PORT, () => {
    logger.info('Tracking service running', { port: PORT, protocol: 'HTTP + WebSocket' });
  });
}

start().catch((err) => {
  logger.error('Failed to start tracking service', { error: err.message });
  process.exit(1);
});
