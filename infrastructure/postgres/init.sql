-- RideFlow Platform - Database Initialization
-- Creates all tables for the microservices

-- Rides table (owned by ride-service)
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id UUID NOT NULL,
  driver_id UUID,
  status VARCHAR(30) NOT NULL DEFAULT 'requested',
  pickup_lat DECIMAL(10, 8) NOT NULL,
  pickup_lng DECIMAL(11, 8) NOT NULL,
  pickup_address TEXT NOT NULL,
  destination_lat DECIMAL(10, 8) NOT NULL,
  destination_lng DECIMAL(11, 8) NOT NULL,
  destination_address TEXT NOT NULL,
  estimated_distance_km DECIMAL(8, 2),
  estimated_price DECIMAL(10, 2),
  final_price DECIMAL(10, 2),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drivers table (owned by driver-service)
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  license_plate VARCHAR(20),
  vehicle_model VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  current_lat DECIMAL(10, 8),
  current_lng DECIMAL(11, 8),
  rating DECIMAL(3, 2) DEFAULT 5.00,
  total_rides INTEGER DEFAULT 0,
  location_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Passengers table (owned by ride-service / auth)
CREATE TABLE IF NOT EXISTS passengers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  rating DECIMAL(3, 2) DEFAULT 5.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payments table (owned by payment-service)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id),
  passenger_id UUID NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(50),
  external_transaction_id VARCHAR(255),
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  failure_reason TEXT,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Domain events log (for audit trail / event sourcing)
CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  metadata JSONB,
  correlation_id UUID,
  causation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dead letter queue records
CREATE TABLE IF NOT EXISTS dead_letter_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_queue VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT,
  error_code VARCHAR(100),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ NOT NULL,
  last_attempt_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'failed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed some test drivers
INSERT INTO drivers (id, name, email, phone, license_plate, vehicle_model, status, current_lat, current_lng)
VALUES
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567801', 'Carlos Silva', 'carlos@rideflow.com', '+5511999990001', 'ABC-1234', 'Honda Civic 2022', 'available', -23.548520, -46.638308),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567802', 'Ana Souza', 'ana@rideflow.com', '+5511999990002', 'XYZ-5678', 'Toyota Corolla 2023', 'available', -23.552310, -46.641100),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567803', 'Pedro Lima', 'pedro@rideflow.com', '+5511999990003', 'DEF-9012', 'VW Polo 2021', 'offline', -23.545000, -46.630000)
ON CONFLICT (email) DO NOTHING;

-- Seed a test passenger
INSERT INTO passengers (id, name, email, phone)
VALUES
  ('b1c2d3e4-f5a6-7890-bcde-fa1234567890', 'João Oliveira', 'joao@rideflow.com', '+5511988880001')
ON CONFLICT (email) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_rides_passenger_id ON rides(passenger_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events(aggregate_id, aggregate_type);
CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(event_type);
CREATE INDEX IF NOT EXISTS idx_payments_ride_id ON payments(ride_id);
