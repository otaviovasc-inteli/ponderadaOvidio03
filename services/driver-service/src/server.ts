import express from 'express';
import { createLogger } from '../../../shared/utils/logger';
import { BaseError } from '../../../shared/errors/base-error';
import { connectRabbitMQ, publishEvent } from './messaging/rabbitmq';
import { query } from './db/database';
import { createEvent } from '../../../shared/utils/event-factory';
import { EventTypes, DriverLocationUpdatedPayload } from '../../../shared/types/events';
import { z } from 'zod';

const logger = createLogger('driver-service');
const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'driver-service', timestamp: new Date().toISOString() });
});

// GET /drivers - lista motoristas disponíveis
app.get('/drivers', async (_req, res, next) => {
  try {
    const drivers = await query(
      `SELECT id, name, email, phone, license_plate, vehicle_model, status, 
              current_lat, current_lng, rating, location_updated_at
       FROM drivers WHERE status = 'available'`
    );
    res.json({ success: true, data: drivers, metadata: { version: 'v1', timestamp: new Date().toISOString() } });
  } catch (err) { next(err); }
});

// GET /drivers/:id
app.get('/drivers/:id', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM drivers WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: `Driver ${req.params.id} not found` } });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /drivers/:id/location - motorista atualiza localização (chamado frequentemente)
const locationSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

app.patch('/drivers/:id/location', async (req, res, next) => {
  try {
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'lat and lng are required' } });
    }

    const { lat, lng } = parsed.data;
    const rows = await query(
      `UPDATE drivers SET current_lat = $2, current_lng = $3, location_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING id, name, status, current_lat, current_lng`,
      [req.params.id, lat, lng]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' } });
    }

    // Publica evento de localização atualizada para o Matching Service e Tracking Service
    await publishEvent(
      createEvent<DriverLocationUpdatedPayload>(
        EventTypes.DRIVER_LOCATION_UPDATED, req.params.id, 'Driver',
        { driverId: req.params.id, lat, lng, updatedAt: new Date().toISOString() },
        { correlationId: String(req.headers['x-request-id'] || ''), source: 'driver-service' },
      )
    );

    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /drivers/:id/status
app.patch('/drivers/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ['offline', 'available', 'on_ride'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: `status must be one of: ${validStatuses.join(', ')}` } });
    }

    const rows = await query(
      'UPDATE drivers SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id, status]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' } });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof BaseError && err.isOperational) {
    return res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
  }
  logger.error('Unhandled error', { error: err.message });
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

async function start() {
  await connectRabbitMQ();
  app.listen(PORT, () => logger.info('Driver service running', { port: PORT }));
}

start().catch((err) => {
  logger.error('Failed to start driver service', { error: err.message });
  process.exit(1);
});

export default app;
