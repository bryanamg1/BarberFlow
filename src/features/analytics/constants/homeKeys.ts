import type { AppointmentScope } from '@/features/appointments/types/appointmentHooks.types';

export const homeKeys = {
  nextAppointment: (scope: AppointmentScope | null, timezone: string | null) =>
    ['home', scope?.businessId ?? null, 'next-appointment', scope, timezone] as const,
};
