# INTEGRATION_GUIDE.md — Controle de Qualidade de Integração

Este documento cobre o **requisito (b)** da avaliação: documentar e demonstrar no código os mecanismos de controle de qualidade de integração — **timings, protocolos, versionamento e tratamento de exceções**.

---

## 1. Timings e Timeouts

Um dos maiores riscos em sistemas distribuídos é uma chamada remota que nunca responde, travando recursos indefinidamente. No RideFlow, todo timeout é explícito e configurável.

### 1.1 Timeouts HTTP (API Gateway → Serviços)

Cada rota proxy no API Gateway define um timeout de **25 segundos**:

```typescript
// services/api-gateway/src/routes/rides.ts
const response = await axios.post(`${RIDE_SERVICE_URL}/rides/request`, req.body, {
  timeout: TIMEOUT_MS, // 25000ms
  headers: { 'x-request-id': req.headers['x-request-id'] },
});
```

Se o serviço interno não responder em 25s, o gateway retorna `503 Service Unavailable` ao cliente. Esse valor cobre o tempo de matching (até 30s internamente), mas como o matching é assíncrono, a criação da corrida retorna imediatamente em ~100ms.

### 1.2 Timeout do Banco de Dados

O pool de conexões do PostgreSQL tem dois timeouts:

```typescript
// services/ride-service/src/db/database.ts
pool = new Pool({
  connectionTimeoutMillis: 5000,  // espera até 5s para obter uma conexão
  idleTimeoutMillis: 30000,       // fecha conexões ociosas após 30s
  max: 10,                        // máximo 10 conexões simultâneas
});
```

### 1.3 Timeout de Matching

O tempo máximo para encontrar um motorista é configurável:

```typescript
// services/matching-service/src/server.ts
const MATCHING_TIMEOUT_MS = parseInt(process.env.MATCHING_TIMEOUT_MS || '30000', 10);

// Aplicado como TTL na fila RabbitMQ — mensagens expiram automaticamente
await channel.assertQueue(QUEUE, {
  arguments: { 'x-message-ttl': MATCHING_TIMEOUT_MS },
});
```

### 1.4 TTL de Mensagens de Localização

Dados de localização antigos não têm utilidade. A fila do tracking tem TTL de 5s:

```typescript
// services/tracking-service/src/server.ts
await channel.assertQueue(QUEUE, {
  durable: false,
  arguments: { 'x-message-ttl': 5000 }, // 5s — localização velha é descartada
});
```

### 1.5 SLAs por Operação

| Operação | SLA esperado | Timeout configurado |
|---|---|---|
| Criar corrida | < 500ms | 25s (gateway) |
| Matching de motorista | < 30s | 30s (TTL fila) |
| Autorização de pagamento | < 2s | 3 tentativas × ~1s |
| Atualização de localização | < 100ms | 5s TTL na fila |
| Captura de pagamento | < 1s | 3 tentativas |
| Notificação (push/SMS) | best effort | Sem timeout rígido |

---

## 2. Protocolos de Integração

### 2.1 REST/HTTP — Comunicação Síncrona

Usado para operações onde o cliente precisa de resposta imediata. Padrões aplicados:

- **Método HTTP semântico**: `POST` para criar, `GET` para consultar, `PATCH` para atualizar estado.
- **Status codes corretos**: `201` para criação, `200` para sucesso, `400` para validação, `404` para não encontrado, `422` para transição inválida, `429` para rate limit, `500` para erros internos.
- **Correlation ID**: cada requisição recebe um `x-request-id` no gateway, propagado para todos os serviços internos para rastreamento distribuído.
- **Content-Type**: sempre `application/json`.

Exemplo de resposta padronizada (`ApiResponse<T>`):

```json
{
  "success": true,
  "data": { "id": "...", "status": "requested" },
  "metadata": {
    "version": "v1",
    "timestamp": "2024-03-15T12:00:00.000Z",
    "requestId": "abc-123"
  }
}
```

### 2.2 AMQP — Comunicação Assíncrona

Usado para eventos de domínio onde o produtor não precisa esperar o consumidor. Padrões aplicados:

- **Topic Exchange**: routing key no formato `<aggregate>.<eventType>` (ex: `ride.ride_requested`). Permite que consumidores usem wildcards (`ride.*`).
- **Mensagens duráveis**: `persistent: true` — sobrevivem a restart do broker.
- **Prefetch**: limita quantas mensagens um consumidor processa simultaneamente para evitar sobrecarga.
- **Dead Letter Queue**: mensagens que falham após todas as tentativas vão para `dead.letter`.
- **Acknowledgement explícito**: `ack()` só após processamento bem-sucedido; `nack()` em caso de erro.

Envelope de evento de domínio:

```typescript
// shared/types/events.ts
interface DomainEvent<T> {
  eventId: string;        // UUID único por evento
  eventType: string;      // ex: "RIDE_REQUESTED"
  aggregateId: string;    // ID da entidade (rideId, driverId)
  aggregateType: string;  // ex: "Ride"
  version: number;        // versão do schema do evento
  timestamp: string;      // ISO 8601
  correlationId: string;  // rastreamento distribuído
  causationId?: string;   // qual evento causou este
  source: string;         // qual serviço publicou
  payload: T;             // dados específicos do evento
}
```

### 2.3 WebSocket — Comunicação em Tempo Real

Usado exclusivamente para rastreamento de localização, onde o modelo request/response é inadequado:

- **Socket.io** gerencia reconexão automática, fallback para long-polling e rooms.
- Clientes entram na room `ride:<rideId>` para receber eventos específicos.
- Servidor emite `driver:location` e `ride:status` sem solicitação do cliente (push).
- `pingTimeout: 10000` e `pingInterval: 5000` para detectar desconexões rapidamente.

---

## 3. Versionamento

### 3.1 Versionamento de API

Todas as rotas externas têm prefixo de versão:

```
/api/v1/rides/request
/api/v1/drivers/:id/location
/api/v1/payments/:rideId
```

Isso permite que `/api/v2/` seja introduzido com mudanças incompatíveis sem quebrar clientes existentes. O gateway roteia por prefixo.

### 3.2 Versionamento de Eventos

Cada evento carrega um campo `version` (atualmente `1`). A política de evolução é:

- **Adição de campos opcionais**: retrocompatível, não incrementa versão.
- **Mudança de campo obrigatório ou remoção**: incrementa `version`, consumidores devem verificar:

```typescript
// Consumidor verifica versão antes de processar
if (event.version > MAX_SUPPORTED_VERSION) {
  logger.warn('Unsupported event version, skipping', { version: event.version });
  channel.nack(msg, false, false); // envia para dead letter
  return;
}
```

### 3.3 Versionamento de Schema do Banco

O `init.sql` define o schema inicial. Para migrações futuras seria usado **Flyway** ou **node-pg-migrate**, com arquivos numerados sequencialmente (`V1__initial.sql`, `V2__add_rating.sql`).

---

## 4. Tratamento de Exceções

### 4.1 Hierarquia de Erros

Todos os erros do sistema herdam de `BaseError`:

```typescript
// shared/errors/base-error.ts

class BaseError extends Error {
  isOperational: boolean  // true = erro previsto; false = bug
  statusCode: number
  code: string
}

// Erros de domínio (operacionais — o cliente pode entender e agir)
class RideNotFoundError extends BaseError        // 404
class RideAlreadyActiveError extends BaseError   // 409
class InvalidRideStatusTransitionError extends BaseError // 422
class ValidationError extends BaseError          // 400
class UnauthorizedError extends BaseError        // 401

// Erros de infraestrutura (não-operacionais — bug ou falha de sistema)
class DatabaseError extends BaseError            // 503
class MessageBrokerError extends BaseError       // 503
class ExternalServiceError extends BaseError     // 502
```

### 4.2 Error Handler Centralizado

O middleware de erro no API Gateway distingue erros operacionais de bugs:

```typescript
// services/api-gateway/src/middleware/error-handler.ts
if (err instanceof BaseError && err.isOperational) {
  // Erro previsto → cliente recebe mensagem clara
  return res.status(err.statusCode).json({
    success: false,
    error: { code: err.code, message: err.message },
  });
}

// Erro inesperado → loga stack completa, cliente recebe mensagem genérica
logger.error('Unhandled error', { error: err.message, stack: err.stack });
return res.status(500).json({
  success: false,
  error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
});
```

### 4.3 Retentativas com Backoff Exponencial

Para operações que podem falhar transitoriamente (rede, banco, fila), o sistema usa retentativa com jitter para evitar thundering herd:

```typescript
// shared/utils/retry.ts
delay = min(initialDelay × multiplier^attempt + random_jitter, maxDelay)

// Configurações por tipo de operação:
RETRY_CONFIGS.database    = { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 2000 }
RETRY_CONFIGS.messageQueue = { maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 30000 }
RETRY_CONFIGS.externalAPI  = { maxAttempts: 3, initialDelayMs: 500, maxDelayMs: 5000 }
```

Exemplo de uso no ride-service para conexão com banco:

```typescript
const result = await withRetry(
  async () => {
    const client = await pool.connect();
    const rows = await client.query(sql, params);
    return rows;
  },
  RETRY_CONFIGS.database,
  'db-query',
);
```

### 4.4 Dead Letter Queue (DLQ)

Mensagens que falham após todas as tentativas não são perdidas — vão para a DLQ:

```typescript
// services/ride-service/src/messaging/rabbitmq.ts
await channel.assertQueue(queueName, {
  arguments: {
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': 'dead.letter', // fila de destino
    'x-message-ttl': 60000,
  },
});

// Na lógica de consumo:
if (retryCount >= MAX_RETRIES) {
  logger.error('Message sent to dead letter queue', { queue, retryCount });
  channel.nack(msg, false, false); // false, false = não requeue
}
```

A tabela `dead_letter_messages` no banco registra as mensagens para análise posterior.

### 4.5 Idempotência no Pagamento

Para evitar cobranças duplicadas em caso de retry, o Payment Service usa chave de idempotência:

```typescript
// services/payment-service/src/server.ts
const idempotencyKey = `auth-${rideId}`;

// Verifica se já existe antes de processar
const existing = await pool.query(
  'SELECT id FROM payments WHERE idempotency_key = $1',
  [idempotencyKey],
);
if (existing.rows.length > 0) {
  logger.warn('Payment already authorized (idempotent)', { idempotencyKey });
  return; // retorna sem processar novamente
}
```

### 4.6 Validação de Entrada

Todas as entradas externas são validadas com **Zod** antes de chegar à lógica de negócio:

```typescript
// services/ride-service/src/ride.controller.ts
const requestRideSchema = z.object({
  passengerId: z.string().uuid(),
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    address: z.string().min(1),
  }),
  destination: z.object({ ... }),
});

const parsed = requestRideSchema.safeParse(req.body);
if (!parsed.success) {
  throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
}
```

---

## 5. Observabilidade

### 5.1 Logging Estruturado

Todos os serviços usam o mesmo logger JSON, facilitando agregação com ferramentas como Elasticsearch/Kibana ou Datadog:

```json
{
  "timestamp": "2024-03-15T12:00:00.123Z",
  "level": "info",
  "service": "ride-service",
  "message": "Ride requested",
  "rideId": "abc-123",
  "passengerId": "xyz-456",
  "correlationId": "req-789"
}
```

### 5.2 Health Checks

Cada serviço expõe `/health`:

```json
{ "status": "healthy", "service": "ride-service", "timestamp": "..." }
```

O Docker Compose usa esses endpoints para `healthcheck`, garantindo que um serviço só recebe tráfego quando está pronto.

### 5.3 Rastreamento Distribuído

O `x-request-id` gerado no API Gateway (ou fornecido pelo cliente) é propagado como `correlationId` em todos os eventos de domínio e como header em todas as chamadas HTTP internas. Isso permite rastrear um fluxo completo cruzando múltiplos logs de serviços diferentes.

---

## 6. Resumo dos Mecanismos de Qualidade

| Mecanismo | Onde está implementado | Arquivo relevante |
|---|---|---|
| Timeouts HTTP | API Gateway routes | `routes/rides.ts`, `routes/drivers.ts` |
| Timeout de banco | DB pool config | `ride-service/src/db/database.ts` |
| TTL de mensagens | RabbitMQ queue args | `messaging/rabbitmq.ts` |
| Retry + backoff | Todas as operações IO | `shared/utils/retry.ts` |
| Dead Letter Queue | Todos os consumers | `messaging/rabbitmq.ts` |
| Idempotência | Pagamentos | `payment-service/src/server.ts` |
| Validação de input | Controllers | `ride.controller.ts` |
| Hierarquia de erros | Toda a aplicação | `shared/errors/base-error.ts` |
| Logging estruturado | Todos os serviços | `shared/utils/logger.ts` |
| Versionamento de API | API Gateway | Prefixo `/api/v1/` |
| Versionamento de eventos | Todos os eventos | `shared/types/events.ts` campo `version` |
| Correlation ID | Gateway + todos | Header `x-request-id` / campo `correlationId` |
| Rate limiting | API Gateway | `middleware/rate-limiter.ts` |
| State machine | Ride Service | `ride.service.ts` `ALLOWED_TRANSITIONS` |
