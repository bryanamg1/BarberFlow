import type { ClientErrorCode, ClientServiceError } from '../types/client.types';

const errorMessages: Record<ClientErrorCode, string> = {
  CLIENT_NOT_FOUND: 'No se encontró el cliente o no está disponible.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  CLIENT_ACCESS_DENIED: 'No se pudo acceder al cliente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del cliente. Inténtalo nuevamente.',
};

export function clientError(code: ClientErrorCode): ClientServiceError {
  return { code, message: errorMessages[code] };
}
