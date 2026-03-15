import rateLimit from 'express-rate-limit';

// Limita requisições por IP para evitar abuso da API
export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // janela de 1 minuto
  max: 100,            // máximo 100 requisições por janela
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please wait before trying again.',
    },
  },
  skip: (req) => req.path === '/health',
});
