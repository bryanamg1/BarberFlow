import type { AppointmentScope } from '../types/appointmentHooks.types';
import type { AppointmentAvailabilityInput, AppointmentRange } from '../types/appointment.types';

export const appointmentsKeys = {
  all: ['appointments'] as const,
  byBusiness: (businessId: string | null) => ['appointments', businessId] as const,
  scope: (scope: AppointmentScope | null) =>
    ['appointments', scope?.businessId ?? null, scope] as const,
  list: (scope: AppointmentScope | null, range: AppointmentRange | null) =>
    [
      ...appointmentsKeys.scope(scope),
      'list',
      range && { from: range.from, to: range.to },
    ] as const,
  detail: (scope: AppointmentScope | null, appointmentId: string | null) =>
    [...appointmentsKeys.scope(scope), 'detail', appointmentId] as const,
  availability: (scope: AppointmentScope | null, input: AppointmentAvailabilityInput | null) =>
    [
      ...appointmentsKeys.scope(scope),
      'availability',
      input && {
        barberMemberId: input.barberMemberId,
        date: input.date,
        durationMinutes: input.durationMinutes,
        excludeAppointmentId: input.excludeAppointmentId,
      },
    ] as const,
  mutation: (scope: AppointmentScope | null, operation: string) =>
    [...appointmentsKeys.scope(scope), 'mutation', operation] as const,
};
