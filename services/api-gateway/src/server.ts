import express from 'express';
import { randomUUID } from 'crypto';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rate-limiter';
import { createRideRouter } from './routes/rides';
import { createDriverRouter } from './routes/drivers';
import { createPaymentRouter } from './routes/payments';
import { setupSwagger } from './config/swagger';
import { createLogger } from '../../../shared/utils/logger';

const logger = createLogger('api-gateway');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Injeta um request ID único em cada requisição para rastreamento distribuído
app.use((req, res, next) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-ID', req.headers['x-request-id'] as string);
  res.setHeader('X-API-Version', 'v1');
  next();
});

// Rate limiting global
app.use(rateLimiter);

// Health check (não requer autenticação)
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Swagger docs
setupSwagger(app);

// Rotas protegidas por JWT
app.use('/api/v1/rides', authMiddleware, createRideRouter());
app.use('/api/v1/drivers', authMiddleware, createDriverRouter());
app.use('/api/v1/payments', authMiddleware, createPaymentRouter());

// Auth endpoint (gera token de teste)
app.post('/api/v1/auth/token', (req, res) => {
  const jwt = require('jsonwebtoken');
  const { userId, role } = req.body;
  if (!userId || !role) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'userId and role are required' },
    });
  }
  const token = jwt.sign(
    { sub: userId, role },
    process.env.JWT_SECRET || 'supersecretjwt2026',
    { expiresIn: '24h' },
  );
  return res.json({ success: true, data: { token }, metadata: { version: 'v1', timestamp: new Date().toISOString(), requestId: req.headers['x-request-id'] } });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'],
    },
    metadata: { version: 'v1', timestamp: new Date().toISOString(), requestId: String(req.headers['x-request-id']) },
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`API Gateway running`, { port: PORT, env: process.env.NODE_ENV });
});

export default app;
