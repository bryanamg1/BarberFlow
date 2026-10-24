import { skipToken, useQuery } from '@tanstack/react-query';

import type { WorkingMember } from '@/features/business/repositories/businessDirectoryRepository';
import { businessDirectoryService } from '@/features/business/services/businessDirectoryService';

import { appointmentHookError, appointmentQueryState, readAppointment } from './appointmentQuery';
import { useAppointmentLifecycle } from './useAppointmentLifecycle';
import type { AppointmentServiceError } from '../services/appointmentErrors';

// D08's operational directory, reusable by the later appointment form without profiles.
export function useWorkingMembers() {
  const lifetime = useAppointmentLifecycle('working-members');
  const { scope } = lifetime;
  const query = useQuery<WorkingMember[], AppointmentServiceError>({
    queryKey: ['business', scope?.businessId ?? null, 'working-members', scope],
    enabled: scope !== null,
    retry: false,
    queryFn:
      scope === null
        ? skipToken
        : ({ signal }) =>
            readAppointment(
              async () => {
                const result = await businessDirectoryService.listWorkingMembers(
                  scope.businessId,
                  scope.role === 'BARBER' ? scope.membershipId : undefined,
                );
                return result.error
                  ? { data: null, error: appointmentHookError('UNKNOWN_ERROR') }
                  : result;
              },
              () => !signal.aborted && lifetime.isCurrent(),
            ),
  });
  return appointmentQueryState(query, scope !== null, true, async () => {
    if (lifetime.isCurrent()) await query.refetch();
  });
}
