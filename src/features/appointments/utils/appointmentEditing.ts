import type { AppointmentScope } from '../types/appointmentHooks.types';
import type { AppointmentRow } from '../types/appointment.types';
import { rescheduleAppointmentSchema } from '../schemas/appointment.schema';

// UI affordance only. D01 and every write remain enforced by the existing RPCs.
export function canManageAppointment(appointment: AppointmentRow, scope: AppointmentScope | null) {
  return (
    scope !== null &&
    appointment.business_id === scope.businessId &&
    ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status) &&
    (scope.role === 'OWNER' || appointment.barber_member_id === scope.membershipId)
  );
}

export function persistedAppointmentMinutes(appointment: AppointmentRow): number | null {
  const value = (Date.parse(appointment.end_at) - Date.parse(appointment.start_at)) / 60_000;
  const parsed = rescheduleAppointmentSchema.shape.durationOverride.unwrap().safeParse(value);
  return parsed.success ? parsed.data : null;
}
