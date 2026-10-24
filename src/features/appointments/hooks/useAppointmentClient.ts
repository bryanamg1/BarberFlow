import { skipToken, useQuery } from '@tanstack/react-query';

import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { clientsService } from '@/features/clients/services/clientsService';

import { appointmentHookError, appointmentQueryState, readAppointment } from './appointmentQuery';
import { usableAppointmentId, useAppointmentLifecycle } from './useAppointmentLifecycle';
import type { AppointmentServiceError } from '../services/appointmentErrors';

export function useAppointmentClient(clientId: string | null) {
  const lifetime = useAppointmentLifecycle(JSON.stringify(['appointment-client', clientId]));
  const { scope } = lifetime;
  const valid = usableAppointmentId(clientId);
  const query = useQuery<ClientRow, AppointmentServiceError>({
    queryKey: ['clients', scope?.businessId ?? null, 'appointment-detail', scope, clientId],
    enabled: scope !== null && valid,
    retry: false,
    queryFn:
      scope === null || !valid
        ? skipToken
        : ({ signal }) =>
            readAppointment(
              async () => {
                const result = await clientsService.getById(scope.businessId, clientId);
                if (result.error)
                  return {
                    data: null,
                    error: appointmentHookError(
                      result.error.code === 'CLIENT_NOT_FOUND'
                        ? 'APPOINTMENT_NOT_FOUND'
                        : 'UNKNOWN_ERROR',
                    ),
                  };
                if (result.data.id !== clientId || result.data.business_id !== scope.businessId)
                  return { data: null, error: appointmentHookError('APPOINTMENT_NOT_FOUND') };
                return result;
              },
              () => !signal.aborted && lifetime.isCurrent(),
            ),
  });
  return appointmentQueryState(query, scope !== null, valid, async () => {
    if (lifetime.isCurrent() && valid) await query.refetch();
  });
}
