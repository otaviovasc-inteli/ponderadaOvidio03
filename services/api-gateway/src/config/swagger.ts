import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'RideFlow API',
    version: '1.0.0',
    description: `
## RideFlow - Plataforma de Ride-Sharing

API Gateway que centraliza as chamadas para os microserviços da plataforma.

### Fluxo principal:
1. Passageiro solicita corrida via \`POST /api/v1/rides/request\`
2. Sistema faz matching com motorista disponível (automático, event-driven)
3. Motorista aceita, pagamento é pré-autorizado
4. Corrida acontece com rastreamento em tempo real
5. Ao finalizar, pagamento é capturado e notificações enviadas
    `,
    contact: {
      name: 'RideFlow Engineering',
      email: 'eng@rideflow.com',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'RIDE_NOT_FOUND' },
              message: { type: 'string', example: 'Ride abc-123 not found' },
              timestamp: { type: 'string', format: 'date-time' },
              requestId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      Location: {
        type: 'object',
        required: ['lat', 'lng', 'address'],
        properties: {
          lat: { type: 'number', example: -23.55052 },
          lng: { type: 'number', example: -46.633308 },
          address: { type: 'string', example: 'Av. Paulista, 1578, São Paulo' },
        },
      },
      Ride: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          passengerId: { type: 'string', format: 'uuid' },
          driverId: { type: 'string', format: 'uuid' },
          status: {
            type: 'string',
            enum: ['requested', 'matching', 'accepted', 'driver_en_route', 'in_progress', 'completed', 'cancelled'],
          },
          pickup: { $ref: '#/components/schemas/Location' },
          destination: { $ref: '#/components/schemas/Location' },
          estimatedDistanceKm: { type: 'number', example: 5.2 },
          estimatedPrice: { type: 'number', example: 25.50 },
          finalPrice: { type: 'number', example: 27.30 },
          requestedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          200: { description: 'Service is healthy' },
        },
      },
    },
    '/api/v1/auth/token': {
      post: {
        tags: ['Auth'],
        summary: 'Generate test JWT token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'role'],
                properties: {
                  userId: { type: 'string', format: 'uuid', example: 'b1c2d3e4-f5a6-7890-bcde-fa1234567890' },
                  role: { type: 'string', enum: ['passenger', 'driver', 'admin'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Token generated successfully' },
        },
      },
    },
    '/api/v1/rides/request': {
      post: {
        tags: ['Rides'],
        summary: 'Request a new ride',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['passengerId', 'pickup', 'destination'],
                properties: {
                  passengerId: { type: 'string', format: 'uuid' },
                  pickup: { $ref: '#/components/schemas/Location' },
                  destination: { $ref: '#/components/schemas/Location' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Ride requested successfully' },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Passenger already has an active ride' },
        },
      },
    },
    '/api/v1/rides/{id}': {
      get: {
        tags: ['Rides'],
        summary: 'Get ride by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Ride found' },
          404: { description: 'Ride not found' },
        },
      },
    },
    '/api/v1/rides/{id}/cancel': {
      patch: {
        tags: ['Rides'],
        summary: 'Cancel a ride',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { reason: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Ride cancelled' },
          422: { description: 'Invalid status transition' },
        },
      },
    },
    '/api/v1/drivers': {
      get: {
        tags: ['Drivers'],
        summary: 'List available drivers',
        responses: {
          200: { description: 'List of available drivers' },
        },
      },
    },
    '/api/v1/drivers/{id}/location': {
      patch: {
        tags: ['Drivers'],
        summary: 'Update driver location',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lat', 'lng'],
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Location updated' },
        },
      },
    },
  },
};

export function setupSwagger(app: Express): void {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    customSiteTitle: 'RideFlow API Docs',
  }));
}
