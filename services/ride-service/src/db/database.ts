import { Pool, PoolClient } from 'pg';
import { createLogger } from '../../../../shared/utils/logger';
import { withRetry, RETRY_CONFIGS } from '../../../../shared/utils/retry';

const logger = createLogger('ride-service:db');

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected DB pool error', { error: err.message });
    });
  }
  return pool;
}

export async function query<T = any>(
  sql: string,
  params?: any[],
): Promise<T[]> {
  return withRetry(
    async () => {
      const client = await getPool().connect();
      try {
        const result = await client.query(sql, params);
        return result.rows as T[];
      } finally {
        client.release();
      }
    },
    RETRY_CONFIGS.database,
    'db-query',
  );
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
