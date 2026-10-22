import { skipToken, useQuery } from '@tanstack/react-query';

import { appointmentsKeys } from '../constants/appointmentsKeys';
import { appointmentRangeSchema } from '../schemas/appointment.schema';
import type { AppointmentServiceError } from '../services/appointmentErrors';
import { appointmentsService } from '../services/appointmentsService';
import type { AppointmentQueryResult } from '../types/appointmentHooks.types';
import type { AppointmentRange, AppointmentRow } from '../types/appointment.types';
import { appointmentQueryState, readAppointment } from './appointmentQuery';
import { useAppointmentLifecycle } from './useAppointmentLifecycle';

export function useAppointments(
  range: AppointmentRange | null,
): AppointmentQueryResult<AppointmentRow[]> {
  const parsed = appointmentRangeSchema.safeParse(range);
  const input = parsed.success ? parsed.data : null;
  const lifetime = useAppointmentLifecycle(JSON.stringify({ range: input }));
  const { scope } = lifetime;
  const query = useQuery<AppointmentRow[], AppointmentServiceError>({
    queryKey: appointmentsKeys.list(scope, input),
    queryFn:
      scope === null || input === null
        ? skipToken
        : () =>
            readAppointment(
              () => appointmentsService.listByRange(scope.businessId, input),
              lifetime.isCurrent,
            ),
    enabled: scope !== null && input !== null,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && input !== null) await query.refetch();
  };
  return appointmentQueryState(query, scope !== null, input !== null, refetch);
}
