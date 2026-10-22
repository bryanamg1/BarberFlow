import { skipToken, useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { appointmentsKeys } from '../constants/appointmentsKeys';
import { rescheduleAppointmentSchema } from '../schemas/appointment.schema';
import { appointmentCivilDateSchema } from '../schemas/appointmentDate.schema';
import type { AppointmentServiceError } from '../services/appointmentErrors';
import { appointmentsService } from '../services/appointmentsService';
import type { AppointmentQueryResult } from '../types/appointmentHooks.types';
import type {
  AppointmentAvailabilityInput,
  AppointmentAvailabilitySlot,
} from '../types/appointment.types';
import { appointmentQueryState, readAppointment } from './appointmentQuery';
import { useAppointmentLifecycle } from './useAppointmentLifecycle';

const schema = z.object({
  barberMemberId: rescheduleAppointmentSchema.shape.barberMemberId,
  date: appointmentCivilDateSchema,
  durationMinutes: rescheduleAppointmentSchema.shape.durationOverride.unwrap(),
  excludeAppointmentId: rescheduleAppointmentSchema.shape.appointmentId.optional(),
});
export function useAvailability(
  input: AppointmentAvailabilityInput | null,
): AppointmentQueryResult<AppointmentAvailabilitySlot[]> {
  const parsed = schema.safeParse(input);
  const params = parsed.success ? parsed.data : null;
  const lifetime = useAppointmentLifecycle(JSON.stringify({ availability: params }));
  const { scope } = lifetime;
  const query = useQuery<AppointmentAvailabilitySlot[], AppointmentServiceError>({
    queryKey: appointmentsKeys.availability(scope, params),
    queryFn:
      scope === null || params === null
        ? skipToken
        : () =>
            readAppointment(
              () => appointmentsService.getAvailability(scope.businessId, params),
              lifetime.isCurrent,
            ),
    enabled: scope !== null && params !== null,
    retry: false,
  });
  const refetch = async () => {
    if (lifetime.isCurrent() && params !== null) await query.refetch();
  };
  return appointmentQueryState(query, scope !== null, params !== null, refetch);
}
