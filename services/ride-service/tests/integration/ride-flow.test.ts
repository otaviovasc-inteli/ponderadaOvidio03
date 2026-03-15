import request from 'supertest';
import app from '../../src/server';

// Testes de integração do fluxo completo de uma corrida.
// Cobrem o "happy path" e cenários de falha para garantir
// que o controle de qualidade de integração está funcionando.

const PASSENGER_ID = 'b1c2d3e4-f5a6-7890-bcde-fa1234567890';
const DRIVER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567801';

describe('Ride Flow - Integration Tests', () => {
  let rideId: string;

  describe('POST /rides/request', () => {
    it('should create a ride successfully with valid payload', async () => {
      const res = await request(app)
        .post('/rides/request')
        .set('x-request-id', 'test-request-001')
        .send({
          passengerId: PASSENGER_ID,
          pickup: {
            lat: -23.55052,
            lng: -46.633308,
            address: 'Av. Paulista, 1578, São Paulo - SP',
          },
          destination: {
            lat: -23.561414,
            lng: -46.656178,
            address: 'Av. Brigadeiro Faria Lima, 3477, São Paulo - SP',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('requested');
      expect(res.body.data.passenger_id).toBe(PASSENGER_ID);
      expect(res.body.data.estimated_distance_km).toBeGreaterThan(0);
      expect(res.body.data.estimated_price).toBeGreaterThan(0);
      expect(res.body.metadata).toHaveProperty('requestId');

      rideId = res.body.data.id;
    });

    it('should return 400 when pickup coordinates are missing', async () => {
      const res = await request(app)
        .post('/rides/request')
        .send({
          passengerId: PASSENGER_ID,
          pickup: { address: 'Missing lat/lng' },
          destination: { lat: -23.56, lng: -46.65, address: 'Destino' },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 with invalid UUID for passengerId', async () => {
      const res = await request(app)
        .post('/rides/request')
        .send({
          passengerId: 'not-a-uuid',
          pickup: { lat: -23.55, lng: -46.63, address: 'Pickup' },
          destination: { lat: -23.56, lng: -46.65, address: 'Destination' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /rides/:id', () => {
    it('should return the ride by ID', async () => {
      if (!rideId) return;

      const res = await request(app).get(`/rides/${rideId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(rideId);
    });

    it('should return 404 for non-existent ride', async () => {
      const res = await request(app).get('/rides/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RIDE_NOT_FOUND');
    });
  });

  describe('PATCH /rides/:id/accept', () => {
    it('should accept a ride successfully', async () => {
      if (!rideId) return;

      const res = await request(app)
        .patch(`/rides/${rideId}/accept`)
        .set('x-user-id', DRIVER_ID)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('accepted');
      expect(res.body.data.driver_id).toBe(DRIVER_ID);
    });
  });

  describe('PATCH /rides/:id/start', () => {
    it('should start a ride after accepted', async () => {
      if (!rideId) return;

      const res = await request(app)
        .patch(`/rides/${rideId}/start`)
        .set('x-user-id', DRIVER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('in_progress');
      expect(res.body.data.started_at).not.toBeNull();
    });
  });

  describe('PATCH /rides/:id/complete', () => {
    it('should complete a ride in progress', async () => {
      if (!rideId) return;

      const res = await request(app)
        .patch(`/rides/${rideId}/complete`)
        .set('x-user-id', DRIVER_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.completed_at).not.toBeNull();
    });
  });

  describe('Status machine transitions', () => {
    it('should reject invalid transition (completed → cancelled)', async () => {
      if (!rideId) return;

      const res = await request(app)
        .patch(`/rides/${rideId}/cancel`)
        .send({ reason: 'Test invalid transition' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  describe('PATCH /rides/:id/cancel', () => {
    it('should cancel a new ride (requested status)', async () => {
      // Cria nova corrida para cancelar
      const createRes = await request(app)
        .post('/rides/request')
        .send({
          passengerId: '11111111-1111-1111-1111-111111111111',
          pickup: { lat: -23.55, lng: -46.63, address: 'Pickup Test' },
          destination: { lat: -23.56, lng: -46.65, address: 'Destination Test' },
        });

      if (createRes.status !== 201) return;

      const newRideId = createRes.body.data.id;

      const cancelRes = await request(app)
        .patch(`/rides/${newRideId}/cancel`)
        .send({ reason: 'Changed mind', cancelledBy: 'passenger' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('cancelled');
      expect(cancelRes.body.data.cancellation_reason).toBe('Changed mind');
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('ride-service');
    });
  });
});
