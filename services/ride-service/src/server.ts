import express from 'express';
import { handleRequestRide, handleGetRide, handleAcceptRide, handleStartRide, handleCompleteRide, handleCancelRide } from './ride.controller';
import { BaseError } from '../../../shared/errors/base-error';
import { createLogger } from '../../../shared/utils/logger';
import { connectRabbitMQ } from './messaging/rabbitmq';

const logger = createLogger('ride-service');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'ride-service', timestamp: new Date().toISOString() });
});

app.post('/rides/request', handleRequestRide);
app.get('/rides/:id', handleGetRide);
app.patch('/rides/:id/accept', handleAcceptRide);
app.patch('/rides/:id/start', handleStartRide);
app.patch('/rides/:id/complete', handleCompleteRide);
app.patch('/rides/:id/cancel', handleCancelRide);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof BaseError && err.isOperational) {
    return res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
  }
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

async function start() {
  await connectRabbitMQ();
  app.listen(PORT, () => {
    logger.info('Ride service running', { port: PORT });
  });
}

start().catch((err) => {
  logger.error('Failed to start ride service', { error: err.message });
  process.exit(1);
});

export default app;
