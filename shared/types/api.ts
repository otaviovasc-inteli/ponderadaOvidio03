// Formato padrão de resposta da API - todos os serviços seguem esse contrato
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  metadata: ResponseMetadata;
}

export interface APIError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
  requestId: string;
}

export interface ResponseMetadata {
  version: string;
  timestamp: string;
  requestId: string;
}

// Status possíveis de uma corrida
export type RideStatus =
  | 'requested'
  | 'matching'
  | 'accepted'
  | 'driver_en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

// Status possíveis de um pagamento
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded';

// Status possíveis de um motorista
export type DriverStatus = 'offline' | 'available' | 'on_ride';

export interface RideDTO {
  id: string;
  passengerId: string;
  driverId?: string;
  status: RideStatus;
  pickup: {
    lat: number;
    lng: number;
    address: string;
  };
  destination: {
    lat: number;
    lng: number;
    address: string;
  };
  estimatedDistanceKm?: number;
  estimatedPrice?: number;
  finalPrice?: number;
  requestedAt: string;
  acceptedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DriverDTO {
  id: string;
  name: string;
  email: string;
  phone: string;
  licensePlate?: string;
  vehicleModel?: string;
  status: DriverStatus;
  currentLat?: number;
  currentLng?: number;
  rating: number;
}
