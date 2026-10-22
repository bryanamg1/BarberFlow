import { skipToken, useQuery } from '@tanstack/react-query';

import { appointmentsKeys } from '../constants/appointmentsKeys';
import type { AppointmentServiceError } from '../services/appointmentErrors';
import { appointmentsService } from '../services/appointmentsService';
import type { AppointmentQueryResult } from '../types/appointmentHooks.types';
import type { AppointmentDetail } from '../types/appointment.types';
import { appointmentQueryState, readAppointment } from './appointmentQuery';
import { usableAppointmentId, useAppointmentLifecycle } from './useAppointmentLifecycle';

export function useAppointmentDetail(
  appointmentId: string | null,
): AppointmentQueryResult<AppointmentDetail> {
  const lifetime = useAppointmentLifecycle(JSON.stringify({ appointmentId }));
  const { scope } = lifetime;
  const valid = usableAppointmentId(appointmentId);
  const query = useQuery<AppointmentDetail, AppointmentServiceError>({
    queryKey: appointmentsKeys.detail(scope, appointmentId),
    queryFn:
      scope === null || !valid
        ? skipToken
        : ({ signal }) =>
            readAppointment(
              () => appointmentsService.getById(scope.businessId, appointmentId),
              () => !signal.aborted && lifetime.isCurrent(),
            ),
    enabled: scope !== null && valid,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && valid) await query.refetch();
  };
  return appointmentQueryState(query, scope !== null, valid, refetch);
}
