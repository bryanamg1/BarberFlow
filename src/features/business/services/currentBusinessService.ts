import { businessRepository } from '../repositories/businessRepository';
import type { CurrentBusinessErrorCode, CurrentBusinessResult } from '../types/business.types';

const errorMessages: Record<CurrentBusinessErrorCode, string> = {
  NO_ACTIVE_MEMBERSHIP: 'No tienes una membresía activa en un negocio.',
  AMBIGUOUS_CURRENT_BUSINESS: 'No se pudo determinar un único negocio actual.',
  BUSINESS_NOT_RESOLVABLE: 'No se pudo acceder al negocio asociado a tu membresía.',
  BUSINESS_INACTIVE: 'El negocio asociado a tu membresía está inactivo.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  BUSINESS_ACCESS_DENIED: 'No tienes acceso al contexto del negocio.',
  UNKNOWN_ERROR: 'No se pudo resolver el negocio actual. Inténtalo nuevamente.',
};

function failure(code: CurrentBusinessErrorCode): CurrentBusinessResult {
  return { data: null, error: { code, message: errorMessages[code] } };
}

export const currentBusinessService = {
  async getCurrentBusiness(userId: string): Promise<CurrentBusinessResult> {
    try {
      const result = await businessRepository.getActiveMembershipsByUserId(userId);
      if (result.error !== null) {
        // PostgREST exposes transport failure status on the response, not the error object.
        if (result.status === 0) return failure('NETWORK_ERROR');
        if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
          return failure('BUSINESS_ACCESS_DENIED');
        }
        return failure('UNKNOWN_ERROR');
      }
      if (result.data === null) return failure('UNKNOWN_ERROR');
      if (result.data.length === 0) return failure('NO_ACTIVE_MEMBERSHIP');
      if (result.data.length > 1) return failure('AMBIGUOUS_CURRENT_BUSINESS');

      // Resolve only the proven unique membership; never filter rows to manufacture uniqueness.
      const [membership] = result.data;
      if (membership.business === null) return failure('BUSINESS_NOT_RESOLVABLE');
      if (!membership.business.is_active) return failure('BUSINESS_INACTIVE');
      return {
        data: {
          membershipId: membership.id,
          role: membership.role,
          business: membership.business,
        },
        error: null,
      };
    } catch {
      return failure('UNKNOWN_ERROR');
    }
  },
};
