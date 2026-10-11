import { clientsRepository } from '../repositories/clientsRepository';
import type { CreateClientInput, UpdateClientInput } from '../schemas/client.schema';
import type {
  ClientErrorCode,
  ClientListParams,
  ClientListResult,
  ClientResult,
  ClientServiceError,
} from '../types/client.types';
import { clientError } from '../utils/clientErrors';
import { normalizeClientListParams } from '../utils/clientListParams';

function failure(code: ClientErrorCode): { data: null; error: ClientServiceError } {
  return { data: null, error: clientError(code) };
}

async function runOperation<T>(
  operation: () => PromiseLike<{
    data: T | null;
    error: { code: string } | null;
    status: number;
  }>,
  nullCode: 'CLIENT_NOT_FOUND' | 'UNKNOWN_ERROR',
): Promise<{ data: T; error: null } | { data: null; error: ClientServiceError }> {
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

  async list(businessId: string, params?: ClientListParams): Promise<ClientListResult> {
    const normalized = normalizeClientListParams(params);
    if (normalized === null) return failure('UNKNOWN_ERROR');

    const result = await runOperation(
      () => clientsRepository.listByBusiness(businessId, normalized),
      'UNKNOWN_ERROR',
    );
    if (result.error !== null) return result;

    return {
      data: {
        items: result.data.slice(0, normalized.pageSize),
        page: normalized.page,
        pageSize: normalized.pageSize,
        hasNextPage: result.data.length > normalized.pageSize,
      },
      error: null,
    };
  },
};
