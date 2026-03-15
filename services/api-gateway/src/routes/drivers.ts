import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';

const DRIVER_SERVICE_URL = process.env.DRIVER_SERVICE_URL || 'http://localhost:3002';
const TIMEOUT_MS = 25000;

export function createDriverRouter(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.get(`${DRIVER_SERVICE_URL}/drivers`, {
        timeout: TIMEOUT_MS,
        headers: { 'x-request-id': req.headers['x-request-id'] },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.get(`${DRIVER_SERVICE_URL}/drivers/${req.params.id}`, {
        timeout: TIMEOUT_MS,
        headers: { 'x-request-id': req.headers['x-request-id'] },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  router.patch('/:id/location', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.patch(`${DRIVER_SERVICE_URL}/drivers/${req.params.id}/location`, req.body, {
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

  router.patch('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.patch(`${DRIVER_SERVICE_URL}/drivers/${req.params.id}/status`, req.body, {
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
