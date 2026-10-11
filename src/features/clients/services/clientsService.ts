import { clientsRepository } from '../repositories/clientsRepository';
import type { CreateClientInput, UpdateClientInput } from '../schemas/client.schema';
import type { ClientErrorCode, ClientResult } from '../types/client.types';

const errorMessages: Record<ClientErrorCode, string> = {
  CLIENT_NOT_FOUND: 'No se encontró el cliente o no está disponible.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  CLIENT_ACCESS_DENIED: 'No se pudo acceder al cliente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del cliente. Inténtalo nuevamente.',
};

function failure(code: ClientErrorCode): ClientResult {
  return { data: null, error: { code, message: errorMessages[code] } };
}

async function runOperation(
  operation: () => PromiseLike<Awaited<ReturnType<typeof clientsRepository.getById>>>,
  nullCode: 'CLIENT_NOT_FOUND' | 'UNKNOWN_ERROR',
): Promise<ClientResult> {
  try {
    const result = await operation();
    if (result.error !== null) {
      if (result.status === 0) return failure('NETWORK_ERROR');
      if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
        return failure('CLIENT_ACCESS_DENIED');
      }
      return failure('UNKNOWN_ERROR');
    }
    if (result.data === null) return failure(nullCode);
    return { data: result.data, error: null };
  } catch {
    return failure('UNKNOWN_ERROR');
  }
}

export const clientsService = {
  getById(businessId: string, clientId: string): Promise<ClientResult> {
    return runOperation(() => clientsRepository.getById(businessId, clientId), 'CLIENT_NOT_FOUND');
  },

  create(businessId: string, input: CreateClientInput): Promise<ClientResult> {
    return runOperation(() => clientsRepository.create(businessId, input), 'UNKNOWN_ERROR');
  },

  update(businessId: string, clientId: string, input: UpdateClientInput): Promise<ClientResult> {
    return runOperation(
      () => clientsRepository.update(businessId, clientId, input),
      'CLIENT_NOT_FOUND',
    );
  },
};
