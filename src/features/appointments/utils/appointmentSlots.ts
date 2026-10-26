import { appointmentRangeSchema } from '../schemas/appointment.schema';
import type { AppointmentAvailabilitySlot } from '../types/appointment.types';
import { appointmentInstantPrecedes } from './appointmentInstant';

// Only order/validate the RPC projection; grid, hours, buffer and conflicts remain in BF144.
export function orderAppointmentSlots(rows: readonly AppointmentAvailabilitySlot[]) {
  if (
    rows.some(
      (row) =>
        typeof row.available !== 'boolean' ||
        !appointmentRangeSchema.safeParse({ from: row.start_at, to: row.end_at }).success,
    )
  )
    throw new Error('Invalid availability response');
  return [...rows].sort((a, b) => {
    if (appointmentInstantPrecedes(a.start_at, b.start_at)) return -1;
    if (appointmentInstantPrecedes(b.start_at, a.start_at)) return 1;
    if (appointmentInstantPrecedes(a.end_at, b.end_at)) return -1;
    return appointmentInstantPrecedes(b.end_at, a.end_at) ? 1 : 0;
  });
}

export function matchingAppointmentSlot(
  rows: readonly AppointmentAvailabilitySlot[],
  value: AppointmentAvailabilitySlot | null,
) {
  return value?.available === true
    ? (rows.find(
        (row) => row.available && row.start_at === value.start_at && row.end_at === value.end_at,
      ) ?? null)
    : null;
}

export function appointmentSlotLabel(slot: AppointmentAvailabilitySlot, timezone: string) {
  // Include UTC offset so the two occurrences of a folded civil hour remain distinguishable.
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });
  return `${formatter.format(new Date(slot.start_at))} → ${formatter.format(new Date(slot.end_at))}`;
}
