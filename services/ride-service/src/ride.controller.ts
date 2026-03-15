import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as RideService from './ride.service';
import { ValidationError } from '../../../shared/errors/base-error';
import { createLogger } from '../../../shared/utils/logger';

const logger = createLogger('ride-service:controller');

const requestRideSchema = z.object({
  passengerId: z.string().uuid(),
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1),
  }),
  destination: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1),
  }),
});

function buildMeta(req: Request) {
  return {
    version: 'v1',
    timestamp: new Date().toISOString(),
    requestId: String(req.headers['x-request-id'] || ''),
  };
}

export async function handleRequestRide(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = requestRideSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
    }

    const correlationId = String(req.headers['x-request-id'] || '');
    const ride = await RideService.requestRide({ ...parsed.data, correlationId });

    logger.info('Ride created via API', { rideId: ride.id, requestId: correlationId });

    res.status(201).json({ success: true, data: ride, metadata: buildMeta(req) });
  } catch (err) {
    next(err);
  }
}

export async function handleGetRide(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await RideService.getRideById(req.params.id);
    res.json({ success: true, data: ride, metadata: buildMeta(req) });
  } catch (err) {
    next(err);
  }
}

export async function handleAcceptRide(req: Request, res: Response, next: NextFunction) {
  try {
    const driverId = req.headers['x-user-id'] as string || req.body.driverId;
    if (!driverId) throw new ValidationError('driverId is required');
    const ride = await RideService.acceptRide(req.params.id, driverId, String(req.headers['x-request-id'] || ''));
    res.json({ success: true, data: ride, metadata: buildMeta(req) });
  } catch (err) {
    next(err);
  }
}

export async function handleStartRide(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await RideService.startRide(req.params.id, String(req.headers['x-request-id'] || ''));
    res.json({ success: true, data: ride, metadata: buildMeta(req) });
  } catch (err) {
    next(err);
  }
}

export async function handleCompleteRide(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await RideService.completeRide(req.params.id, String(req.headers['x-request-id'] || ''));
    res.json({ success: true, data: ride, metadata: buildMeta(req) });
  } catch (err) {
    next(err);
  }
}

export async function handleCancelRide(req: Request, res: Response, next: NextFunction) {
  try {
    const reason = req.body.reason || 'Cancelled by user';
    const cancelledBy = (req.body.cancelledBy as 'passenger' | 'driver' | 'system') || 'passenger';
    const ride = await RideService.cancelRide(req.params.id, cancelledBy, reason, String(req.headers['x-request-id'] || ''));
    res.json({ success: true, data: ride, metadata: buildMeta(req) });
  } catch (err) {
    next(err);
  }
}
