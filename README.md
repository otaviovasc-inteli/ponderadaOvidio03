# RideFlow — Plataforma de Carona por Microserviços

Projeto desenvolvido para a Atividade Ponderada do módulo 9 — **Integração de Sistemas**.

O objetivo é demonstrar um fluxo de integração completo usando arquitetura de microsserviços orientada a eventos, cobrindo os dois requisitos principais da avaliação:

1. **Estrutura de integração**: camadas, módulos, componentes, serviços, processos e protocolos.
2. **Controle de qualidade de integração**: timeouts, versionamento, tratamento de exceções, filas de dead letter e retentativas com backoff exponencial.

---

## Sumário

- [Arquitetura](#arquitetura)
- [Serviços](#serviços)
- [Como rodar](#como-rodar)
- [Fluxo principal](#fluxo-principal)
- [Testes](#testes)
- [Documentação adicional](#documentação-adicional)

---

## Arquitetura

```
Cliente (mobile/web)
        │  HTTPS/REST
        ▼
   API Gateway (:3000)          ← autenticação JWT, rate limit, roteamento
        │
        ├──► Ride Service (:3001)       ← CRUD de corridas, máquina de estados
        ├──► Driver Service (:3002)     ← cadastro e localização de motoristas
        └──► Payment Service (:3003)    ← pagamentos (simula Stripe)

Todos os serviços publicam eventos no RabbitMQ (AMQP/topic exchange)

RabbitMQ (exchange: rideflow.events)
        │
        ├──► Matching Service           ← consome RideRequested, publica MatchFound
        ├──► Payment Service            ← consome RideAccepted / RideCompleted
        ├──► Notification Service       ← consome todos os eventos, envia push/SMS/email
        └──► Tracking Service (:3004)   ← consome DriverLocationUpdated, emite via WebSocket
```

Diagrama completo: ver [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## Serviços

| Serviço | Porta | Protocolo | Responsabilidade |
|---|---|---|---|
| api-gateway | 3000 | REST/HTTP | Autenticação, rate limiting, proxy |
| ride-service | 3001 | REST/HTTP + AMQP | Ciclo de vida da corrida |
| driver-service | 3002 | REST/HTTP + AMQP | Motoristas e localização |
| payment-service | 3003 | REST/HTTP + AMQP | Autorização e captura |
| matching-service | — | AMQP | Alocação de motorista |
| notification-service | — | AMQP | Push / SMS / e-mail |
| tracking-service | 3004 | HTTP + WebSocket | Rastreamento em tempo real |

**Infraestrutura:**

| Componente | Porta |
|---|---|
| PostgreSQL | 5432 |
| Redis | 6379 |
| RabbitMQ | 5672 / 15672 (UI) |

---

## Como rodar

### Pré-requisitos

- Docker ≥ 24
- Docker Compose ≥ 2.20

### Subir tudo

```bash
docker compose up --build
```

Aguarde todos os serviços ficarem `healthy`. A ordem de inicialização já está configurada com `depends_on`.

### Endpoints úteis

| URL | Descrição |
|---|---|
| `http://localhost:3000/health` | Health check do gateway |
| `http://localhost:3000/api-docs` | Swagger UI |
| `http://localhost:15672` | RabbitMQ Management (rideflow / rideflow123) |

### Variáveis de ambiente relevantes

Todas as variáveis com padrões seguros estão nos serviços. Para produção, substituir:

```
JWT_SECRET=<secret forte>
DATABASE_URL=postgres://user:pass@host:5432/db
RABBITMQ_URL=amqp://user:pass@host:5672
```

---

## Fluxo principal

```
1. POST /api/v1/rides/request
        │
        ▼ ride-service cria corrida → publica RideRequested
        │
        ▼ matching-service recebe → busca motoristas → publica MatchFound
        │
        ▼ PATCH /api/v1/rides/:id/accept (motorista aceita)
        │ ride-service muda status → publica RideAccepted
        │ payment-service autoriza pagamento
        │ notification-service envia push para passageiro
        │
        ▼ PATCH /api/v1/rides/:id/start
        │
        ▼ PATCH /api/v1/rides/:id/complete
          ride-service muda status → publica RideCompleted
          payment-service captura pagamento
          notification-service envia recibo
```

---

## Testes

Os testes de integração cobrem o fluxo completo da corrida:

```bash
cd services/ride-service
npm install
npm test
```

Para rodar todos os serviços e testar manualmente:

```bash
# Criar corrida
curl -X POST http://localhost:3000/api/v1/rides/request \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "passengerId": "b1c2d3e4-f5a6-7890-bcde-fa1234567890",
    "pickup": { "lat": -23.55052, "lng": -46.633308, "address": "Av. Paulista" },
    "destination": { "lat": -23.561414, "lng": -46.656178, "address": "Faria Lima" }
  }'
```

---

## Documentação adicional

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — estrutura de integração detalhada (requisito a)
- [`INTEGRATION_GUIDE.md`](./INTEGRATION_GUIDE.md) — controle de qualidade de integração (requisito b)
