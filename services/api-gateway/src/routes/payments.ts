import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003';
const TIMEOUT_MS = 25000;

export function createPaymentRouter(): Router {
  const router = Router();

  router.get('/:rideId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.get(`${PAYMENT_SERVICE_URL}/payments/ride/${req.params.rideId}`, {
        timeout: TIMEOUT_MS,
        headers: { 'x-request-id': req.headers['x-request-id'] },
      });
      res.status(response.status).json(response.data);
    } catch (err: any) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  });

  router.post('/refund', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await axios.post(`${PAYMENT_SERVICE_URL}/payments/refund`, req.body, {
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
