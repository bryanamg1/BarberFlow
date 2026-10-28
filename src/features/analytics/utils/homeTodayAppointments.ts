import type { AppointmentScope } from '@/features/appointments/types/appointmentHooks.types';
import type { AppointmentRow } from '@/features/appointments/types/appointment.types';
import { groupAgenda, type AgendaPeriod } from '@/features/appointments/utils/agendaCalendar';

// Reuse civil-day grouping, but retain the reader's order and original row identity.
export function homeTodaySegments(
  period: AgendaPeriod,
  rows: readonly AppointmentRow[],
  scope: AppointmentScope,
) {
  const grouped = groupAgenda(period, rows, scope.businessId)[0] ?? [];
  const byId = new Map(grouped.map((segment) => [segment.appointment.id, segment]));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const segment = byId.get(row.id);
    if (
      !segment ||
      segment.appointment !== row ||
      seen.has(row.id) ||
      (scope.role === 'BARBER' && row.barber_member_id !== scope.membershipId)
    )
      return [];
    seen.add(row.id);
    return [segment];
  });
}
