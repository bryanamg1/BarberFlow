import { appointmentCivilDateSchema } from '../schemas/appointmentDate.schema';
import { appointmentRangeSchema } from '../schemas/appointment.schema';
import { appointmentInstantPrecedes } from './appointmentInstant';
import type { AppointmentRange, AppointmentRow } from '../types/appointment.types';

export type AgendaDay = { date: string; from: string; to: string };
export type AgendaPeriod = { days: AgendaDay[]; range: AppointmentRange; leading: number };
export type AgendaSegment = { appointment: AppointmentRow; continued: boolean };
const dayMilliseconds = 86_400_000;
const utcDate = (year: number, month: number, day: number) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const key = (date: Date) =>
  `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
function civilDate(value: string) {
  if (!appointmentCivilDateSchema.safeParse(value).success) throw new Error('Invalid civil date');
  const [year, month, day] = value.split('-').map(Number);
  return utcDate(year, month, day);
}
export function shiftCivilDate(value: string, days: number) {
  const date = civilDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  const result = key(date);
  if (!appointmentCivilDateSchema.safeParse(result).success) throw new Error('Invalid civil date');
  return result;
}
function civilFormatter(timezone: string) {
  return new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  });
}
function civilOrdinal(instant: number, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(new Date(instant));
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value;
  const year = Number(part('year'));
  return utcDate(
    part('era') === 'BC' ? 1 - year : year,
    Number(part('month')),
    Number(part('day')),
  ).getTime();
}
export function businessCivilDate(instant: number, timezone: string) {
  return key(new Date(civilOrdinal(instant, civilFormatter(timezone))));
}
// Search for the first instant of a civil day. A DST day need not be 24 hours;
// a skipped civil date has the same boundary as the following date.
function boundary(date: string, formatter: Intl.DateTimeFormat) {
  const target = civilDate(date).getTime();
  let low = target - 2 * dayMilliseconds,
    high = target + 2 * dayMilliseconds;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (civilOrdinal(mid, formatter) < target) low = mid + 1;
    else high = mid;
  }
  return new Date(low).toISOString();
}
export function agendaPeriod(from: string, to: string, timezone: string): AgendaPeriod {
  civilDate(from);
  civilDate(to);
  if (from >= to) throw new Error('Invalid civil range');
  const formatter = civilFormatter(timezone),
    dates: string[] = [];
  for (let date = from; date < to; date = shiftCivilDate(date, 1)) dates.push(date);
  const boundaries = [...dates, to].map((date) => boundary(date, formatter));
  const range = { from: boundaries[0], to: boundaries[boundaries.length - 1] };
  if (!appointmentRangeSchema.safeParse(range).success) throw new Error('Invalid instant range');
  return {
    range,
    leading: (civilDate(from).getUTCDay() + 6) % 7,
    days: dates.map((date, index) => ({
      date,
      from: boundaries[index],
      to: boundaries[index + 1],
    })),
  };
}
export function agendaMonth(civilMonth: string, timezone: string) {
  const from = `${civilMonth}-01`,
    date = civilDate(from);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return agendaPeriod(from, key(date), timezone);
}
export function agendaWeek(civilWeekStart: string, timezone: string) {
  const period = agendaPeriod(civilWeekStart, shiftCivilDate(civilWeekStart, 7), timezone);
  if (period.leading !== 0) throw new Error('Expected Monday civil week start');
  return period;
}
export function groupAgenda(
  period: AgendaPeriod,
  appointments: readonly AppointmentRow[],
  businessId: string,
) {
  const groups = period.days.map(() => [] as AgendaSegment[]);
  const seen = new Set<string>();
  for (const appointment of appointments) {
    if (
      appointment.business_id !== businessId ||
      seen.has(appointment.id) ||
      !appointmentRangeSchema.safeParse({ from: appointment.start_at, to: appointment.end_at })
        .success
    )
      continue;
    seen.add(appointment.id);
    if (
      !appointmentInstantPrecedes(appointment.start_at, period.range.to) ||
      !appointmentInstantPrecedes(period.range.from, appointment.end_at)
    )
      continue;
    let low = 0,
      high = period.days.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (appointmentInstantPrecedes(appointment.start_at, period.days[mid].from)) high = mid;
      else low = mid + 1;
    }
    for (let index = Math.max(0, low - 1); index < period.days.length; index++) {
      const day = period.days[index];
      if (!appointmentInstantPrecedes(day.from, appointment.end_at)) break;
      if (
        appointmentInstantPrecedes(day.from, day.to) &&
        appointmentInstantPrecedes(appointment.start_at, day.to)
      )
        groups[index].push({
          appointment,
          continued: appointmentInstantPrecedes(appointment.start_at, day.from),
        });
    }
  }
  for (const group of groups)
    group.sort((a, b) => {
      if (appointmentInstantPrecedes(a.appointment.start_at, b.appointment.start_at)) return -1;
      if (appointmentInstantPrecedes(b.appointment.start_at, a.appointment.start_at)) return 1;
      return a.appointment.id < b.appointment.id ? -1 : a.appointment.id > b.appointment.id ? 1 : 0;
    });
  return groups;
}
export const agendaDateLabel = (date: string) =>
  new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(civilDate(date));
export const agendaMonthLabel = (month: string) =>
  new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(civilDate(`${month}-01`));
export function agendaAppointmentRange(appointment: AppointmentRow, timezone: string) {
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
  });
  return `${formatter.format(new Date(appointment.start_at))} → ${formatter.format(new Date(appointment.end_at))}`;
}
