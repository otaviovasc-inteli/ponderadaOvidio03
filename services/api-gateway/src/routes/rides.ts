import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { createLogger } from '../../../../shared/utils/logger';

const logger = createLogger('api-gateway:rides');
const RIDE_SERVICE_URL = process.env.RIDE_SERVICE_URL || 'http://localhost:3001';
const TIMEOUT_MS = 25000;

// Proxy das rotas de corrida para o ride-service
export function createRideRouter(): Router {
  const router = Router();

  // POST /api/v1/rides/request
  router.post('/request', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.post(`${RIDE_SERVICE_URL}/rides/request`, req.body, {
        timeout: TIMEOUT_MS,
        headers: {
          'x-request-id': req.headers['x-request-id'],
          'x-user-id': req.user?.sub,
          'x-user-role': req.user?.role,
          'Content-Type': 'application/json',
        },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      logger.error('Failed to proxy ride request', {
        requestId: req.headers['x-request-id'],
        error: err.message,
        status: err.response?.status,
      });
      if (err.response) {
        return res.status(err.response.status).json(err.response.data);
      }
      next(err);
    }
  });

  // GET /api/v1/rides/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.get(`${RIDE_SERVICE_URL}/rides/${req.params.id}`, {
        timeout: TIMEOUT_MS,
        headers: { 'x-request-id': req.headers['x-request-id'] },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  // PATCH /api/v1/rides/:id/cancel
  router.patch('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.patch(`${RIDE_SERVICE_URL}/rides/${req.params.id}/cancel`, req.body, {
        timeout: TIMEOUT_MS,
        headers: {
          'x-request-id': req.headers['x-request-id'],
          'x-user-id': req.user?.sub,
        },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  // PATCH /api/v1/rides/:id/accept
  router.patch('/:id/accept', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.patch(`${RIDE_SERVICE_URL}/rides/${req.params.id}/accept`, req.body, {
        timeout: TIMEOUT_MS,
        headers: {
          'x-request-id': req.headers['x-request-id'],
          'x-user-id': req.user?.sub,
        },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  // PATCH /api/v1/rides/:id/start
  router.patch('/:id/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.patch(`${RIDE_SERVICE_URL}/rides/${req.params.id}/start`, req.body, {
        timeout: TIMEOUT_MS,
        headers: {
          'x-request-id': req.headers['x-request-id'],
          'x-user-id': req.user?.sub,
        },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  // PATCH /api/v1/rides/:id/complete
  router.patch('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.patch(`${RIDE_SERVICE_URL}/rides/${req.params.id}/complete`, req.body, {
        timeout: TIMEOUT_MS,
        headers: {
          'x-request-id': req.headers['x-request-id'],
          'x-user-id': req.user?.sub,
        },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  return router;
}
