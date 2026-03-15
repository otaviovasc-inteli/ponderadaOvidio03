import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JWTPayload {
  sub: string;
  role: 'passenger' | 'driver' | 'admin';
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authorization header missing or malformed',
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'],
      },
      metadata: {
        version: 'v1',
        timestamp: new Date().toISOString(),
        requestId: String(req.headers['x-request-id']),
      },
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET || 'supersecretjwt2026';
    const payload = jwt.verify(token, secret) as JWTPayload;
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Token is invalid or expired',
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'],
      },
      metadata: {
        version: 'v1',
        timestamp: new Date().toISOString(),
        requestId: String(req.headers['x-request-id']),
      },
    });
  }
}
