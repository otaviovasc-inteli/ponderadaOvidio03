import { createLogger } from './logger';

const logger = createLogger('retry-handler');

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

// Configurações padrão por tipo de operação
export const RETRY_CONFIGS: Record<string, RetryConfig> = {
  database: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'DatabaseConnectionError'],
  },
  externalAPI: {
    maxAttempts: 3,
    initialDelayMs: 2000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ExternalServiceError'],
  },
  messageQueue: {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableErrors: ['MessageQueueError', 'ECONNREFUSED'],
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Executa uma função com retry + exponential backoff + jitter
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  operationName = 'unnamed-operation',
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  let delay = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;

      const isRetryable =
        !config.retryableErrors ||
        config.retryableErrors.some(
          (code) =>
            (err as any).code === code ||
            (err as any).constructor?.name === code,
        );

      if (!isRetryable || attempt === config.maxAttempts) {
        logger.error(`Operation '${operationName}' failed permanently`, {
          attempt,
          maxAttempts: config.maxAttempts,
          error: (err as Error).message,
          retryable: isRetryable,
        });
        throw lastError;
      }

      // Jitter evita thundering herd problem
      const jitter = Math.random() * 0.3 * delay;
      const nextDelay = Math.min(delay + jitter, config.maxDelayMs);

      logger.warn(`Retrying operation '${operationName}'`, {
        attempt,
        maxAttempts: config.maxAttempts,
        nextDelayMs: Math.round(nextDelay),
        error: (err as Error).message,
      });

      await sleep(nextDelay);
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  throw lastError;
}
