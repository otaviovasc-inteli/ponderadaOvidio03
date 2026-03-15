# ARCHITECTURE.md — Estrutura de Integração do RideFlow

Este documento descreve a estrutura de integração do sistema, cobrindo camadas, módulos, componentes, serviços, processos e os protocolos utilizados entre eles.

---

## 1. Visão Geral

O RideFlow é uma plataforma de transporte urbano construída sobre uma arquitetura de **microsserviços orientados a eventos**. Cada serviço tem uma responsabilidade única, banco de dados próprio (*database-per-service*) e se comunica com os demais de duas formas:

- **Síncrona**: REST/HTTP — para operações que precisam de resposta imediata (criar corrida, consultar status).
- **Assíncrona**: AMQP (RabbitMQ) — para eventos de domínio que outros serviços precisam reagir (corrida solicitada, pagamento capturado).

---

## 2. Camadas da Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│                     CAMADA DE CLIENTE                     │
│          App Mobile / Web (fora do escopo do projeto)     │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS / REST
┌────────────────────────▼─────────────────────────────────┐
│                    CAMADA DE GATEWAY                      │
│                    API Gateway (:3000)                    │
│   Autenticação JWT · Rate Limiting · Proxy · Swagger      │
└──────┬──────────────────────────────────────────┬────────┘
       │ REST (HTTP interno)                       │
┌──────▼──────────────────────────────────────────▼────────┐
│                   CAMADA DE SERVIÇOS                      │
│                                                           │
│  ride-service(:3001)   driver-service(:3002)              │
│  payment-service(:3003) tracking-service(:3004)           │
└──────┬──────────────────────────────────────────┬────────┘
       │ AMQP (publish)                           │ AMQP (consume)
┌──────▼──────────────────────────────────────────▼────────┐
│                  CAMADA DE MENSAGERIA                     │
│           RabbitMQ — exchange: rideflow.events            │
│           Topic exchange com routing keys semânticas      │
└──────┬──────────────────────────────────────────┬────────┘
       │                                           │
┌──────▼──────────────────────────────────────────▼────────┐
│                CAMADA DE SERVIÇOS DE FUNDO                │
│   matching-service · notification-service                 │
│   (sem porta HTTP — apenas consumidores de filas)         │
└──────────────────────────────────────────────────────────┘
       │
┌──────▼────────────────────────────────────────────────────┐
│                  CAMADA DE PERSISTÊNCIA                    │
│   PostgreSQL (dados relacionais) · Redis (cache/sessão)   │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Módulos e Responsabilidades

### 3.1 API Gateway (`services/api-gateway`)

Único ponto de entrada externo. Responsável por:

- Validar tokens JWT antes de encaminhar qualquer requisição.
- Aplicar rate limiting por IP (100 req/15 min por padrão).
- Adicionar `x-request-id` para rastreamento distribuído (correlation ID).
- Fazer proxy reverso para os serviços internos com timeout de 25s.
- Expor documentação OpenAPI em `/api-docs`.

**Protocolos:** HTTPS (entrada), HTTP (saída interna).

### 3.2 Ride Service (`services/ride-service`)

Responsável pelo ciclo de vida completo de uma corrida:

- Cria corridas, valida disponibilidade do passageiro (sem corridas ativas).
- Implementa máquina de estados com transições validadas:

```
requested → matching → accepted → driver_en_route → in_progress → completed
    │            │          │                              │
    └────────────┴──────────┴──────── cancelled ──────────┘
```

- Calcula distância estimada com a fórmula de Haversine e preço com tarifa base + por km.
- Persiste corridas no PostgreSQL e publica eventos de domínio no RabbitMQ.

**Protocolos:** HTTP (REST), AMQP (publish).

### 3.3 Driver Service (`services/driver-service`)

Gerencia o cadastro e estado dos motoristas:

- Expõe lista de motoristas disponíveis para o Matching Service.
- Recebe atualizações de localização em alta frequência e publica `DriverLocationUpdated`.
- Gerencia transições de status: `offline → available → on_ride`.
- Usa Redis para cache de localização mais recente (baixa latência).

**Protocolos:** HTTP (REST), AMQP (publish).

### 3.4 Matching Service (`services/matching-service`)

Serviço puramente orientado a eventos, sem porta HTTP:

- Consome `RideRequested` e busca o melhor motorista disponível.
- Algoritmo: ordena por score = `distância × 0.7 + (5 − rating) × 0.3`.
- Tenta 3 vezes com espera de 3–10s antes de publicar `MatchFailed`.
- Timeout de matching configurável via `MATCHING_TIMEOUT_MS` (padrão: 30s).

**Protocolos:** AMQP (consume + publish).

### 3.5 Payment Service (`services/payment-service`)

Simula integração com a API do Stripe:

- Consome `RideAccepted` → autoriza o valor estimado (pré-autorização).
- Consome `RideCompleted` → captura o valor final.
- Implementa idempotência por `idempotency_key` para evitar dupla cobrança.
- Simula falha de 5% para demonstrar tratamento de exceção + dead letter.
- Persiste pagamentos no PostgreSQL.

**Protocolos:** HTTP (REST, consulta), AMQP (consume + publish).

### 3.6 Notification Service (`services/notification-service`)

Serviço de fan-out de notificações:

- Consome todos os eventos relevantes de domínio.
- Mapeia cada evento para uma ou mais notificações por canal (push, SMS, email).
- Envia em paralelo com `Promise.allSettled` — falha em um canal não bloqueia os outros.
- Em produção integraria com FCM (push), Twilio (SMS) e SendGrid (email).

**Protocolos:** AMQP (consume).

### 3.7 Tracking Service (`services/tracking-service`)

Ponte entre o barramento de eventos e clientes em tempo real:

- Consome `DriverLocationUpdated` e emite via Socket.io para clientes conectados.
- Consome eventos de corrida e emite status para a sala da corrida (`ride:<rideId>`).
- Mantém cache em memória da última localização de cada motorista.
- TTL de 5s nas mensagens de localização (dados velhos não têm valor).

**Protocolos:** AMQP (consume), WebSocket (Socket.io).

---

## 4. Componentes Compartilhados (`shared/`)

Código reutilizado por todos os serviços:

| Arquivo | Função |
|---|---|
| `shared/types/events.ts` | Interfaces de todos os eventos de domínio + constantes de tipos |
| `shared/types/api.ts` | DTOs de resposta padronizados (`ApiResponse<T>`) |
| `shared/errors/base-error.ts` | Hierarquia de erros: `BaseError → DomainError / InfrastructureError` |
| `shared/utils/logger.ts` | Logger estruturado em JSON com níveis e contexto de serviço |
| `shared/utils/retry.ts` | Retentativa com backoff exponencial + jitter |
| `shared/utils/event-factory.ts` | Fábrica de eventos com UUID, timestamp e correlation ID |

---

## 5. Infraestrutura

### PostgreSQL

- Um único cluster com schemas separados por domínio.
- Tabelas: `rides`, `drivers`, `passengers`, `payments`, `domain_events`, `dead_letter_messages`.
- Inicializado via `infrastructure/postgres/init.sql`.

### RabbitMQ

- Exchange único: `rideflow.events` (tipo: **topic**, durável).
- Routing keys no formato `<aggregate>.<eventType>` — ex: `ride.ride_requested`.
- Filas duráveis com Dead Letter Queue configurada (`dead.letter`).
- Prefetch configurado por serviço (5–50 mensagens) para controle de carga.

### Redis

- Usado pelo API Gateway para armazenar contadores de rate limiting.
- Usado pelo Driver Service para cache de localização.
- TTL configurado por caso de uso.

---

## 6. Fluxo de Eventos de Domínio

```
ride_requested      → matching-service, notification-service
match_found         → notification-service
match_failed        → notification-service
ride_accepted       → payment-service, notification-service
ride_started        → tracking-service, notification-service
ride_completed      → payment-service, notification-service, tracking-service
ride_cancelled      → notification-service
driver_location_updated → tracking-service
payment_authorized  → notification-service
payment_captured    → notification-service
payment_failed      → notification-service
```

---

## 7. Protocolos e Padrões Utilizados

| Protocolo | Onde | Por quê |
|---|---|---|
| REST/HTTP | API Gateway → Serviços | Operações síncronas com resposta imediata |
| AMQP 0-9-1 | Entre todos os serviços | Desacoplamento, resiliência, fan-out |
| WebSocket (Socket.io) | Tracking → Clientes | Baixa latência para posição em tempo real |
| JWT (HS256) | API Gateway | Autenticação stateless e escalável |
| JSON | Todos | Formato universal de serialização |

**Versionamento de API:** prefixo `/api/v1/` em todas as rotas do Gateway.

**Versionamento de Eventos:** campo `version` no envelope `DomainEvent<T>` (atualmente `1`). Novos campos devem ser opcionais para manter retrocompatibilidade.
