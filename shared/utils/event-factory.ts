import { randomUUID } from 'crypto';
import { DomainEvent } from '../types/events';

// Cria o envelope padrão de um evento de domínio
export function createEvent<T>(
  eventType: string,
  aggregateId: string,
  aggregateType: string,
  payload: T,
  options: {
    correlationId?: string;
    causationId?: string;
    userId?: string;
    source: string;
    version?: number;
  },
): DomainEvent<T> {
  return {
    eventId: randomUUID(),
    eventType,
    aggregateId,
    aggregateType,
    version: options.version ?? 1,
    timestamp: new Date().toISOString(),
    correlationId: options.correlationId ?? randomUUID(),
    causationId: options.causationId ?? randomUUID(),
    payload,
    metadata: {
      userId: options.userId,
      source: options.source,
      environment: process.env.NODE_ENV ?? 'development',
    },
  };
}
