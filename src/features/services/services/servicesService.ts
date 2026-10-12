import { servicesRepository } from '../repositories/servicesRepository';
import {
  createServiceSchema,
  updateServiceSchema,
  type CreateServiceInput,
  type UpdateServiceInput,
} from '../schemas/service.schema';
import type {
  ServiceError,
  ServiceErrorCode,
  ServiceResult,
  ServiceListParams,
  ServiceListResult,
} from '../types/service.types';
import { normalizeServiceListParams } from '../utils/serviceListParams';

const messages: Record<ServiceErrorCode, string> = {
  SERVICE_NOT_FOUND: 'No se encontró el servicio o no está disponible.',
  SERVICE_ACCESS_DENIED: 'No se pudo acceder al servicio.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del servicio. Inténtalo nuevamente.',
};

function failure(code: ServiceErrorCode): { data: null; error: ServiceError } {
  return { data: null, error: { code, message: messages[code] } };
}

async function runOperation<T>(
  operation: () => PromiseLike<{ data: T | null; error: { code: string } | null; status: number }>,
  nullCode: 'SERVICE_NOT_FOUND' | 'UNKNOWN_ERROR',
): Promise<{ data: T; error: null } | { data: null; error: ServiceError }> {
  try {
    const result = await operation();
    if (result.error !== null) {
      if (result.status === 0) return failure('NETWORK_ERROR');
      if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
        return failure('SERVICE_ACCESS_DENIED');
      }
      return failure('UNKNOWN_ERROR');
    }
    if (result.data === null) return failure(nullCode);
    return { data: result.data, error: null };
  } catch {
    return failure('UNKNOWN_ERROR');
  }
}

export const servicesService = {
  getById(businessId: string, serviceId: string): Promise<ServiceResult> {
    return runOperation(
      () => servicesRepository.getById(businessId, serviceId),
      'SERVICE_NOT_FOUND',
    );
  },

  create(businessId: string, input: CreateServiceInput): Promise<ServiceResult> {
    const validated = createServiceSchema.safeParse(input);
    if (!validated.success) return Promise.resolve(failure('UNKNOWN_ERROR'));
    return runOperation(
      () => servicesRepository.create(businessId, validated.data),
      'UNKNOWN_ERROR',
    );
  },

  update(businessId: string, serviceId: string, input: UpdateServiceInput): Promise<ServiceResult> {
    const validated = updateServiceSchema.safeParse(input);
    if (!validated.success) return Promise.resolve(failure('UNKNOWN_ERROR'));
    return runOperation(
      () => servicesRepository.update(businessId, serviceId, validated.data),
      'SERVICE_NOT_FOUND',
    );
  },

  async list(businessId: string, params?: ServiceListParams): Promise<ServiceListResult> {
    const normalized = normalizeServiceListParams(params);
    if (normalized === null) return failure('UNKNOWN_ERROR');
    const result = await runOperation(
      () => servicesRepository.listByBusiness(businessId, normalized),
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
