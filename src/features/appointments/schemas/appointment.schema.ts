import { z } from 'zod';

import { APPOINTMENT_STATUSES } from '../types/appointment.types';

const id = z
  .string({ error: 'Ingresa un identificador válido.' })
  .refine((value) => value.trim().length > 0, { error: 'Ingresa un identificador válido.' });
const positiveInteger = z
  .number({ error: 'Ingresa un número entero positivo.' })
  .int({ error: 'Ingresa un número entero positivo.' })
  .min(1, { error: 'El valor debe ser mayor que cero.' })
  .max(2_147_483_647, { error: 'El valor supera el máximo permitido.' });
const notes = z.string({ error: 'Ingresa notas como texto o null.' }).nullable();
const instant = z.iso
  .datetime({ offset: true, error: 'Ingresa una fecha y hora válidas con zona horaria.' })
  .refine((value) => Number.isFinite(Date.parse(value)), {
    error: 'Ingresa una fecha y hora válidas con zona horaria.',
  });

export const createAppointmentItemSchema = z.object({
  serviceId: id,
  quantity: positiveInteger,
});

export const createAppointmentSchema = z.object({
  requestId: id,
  clientId: id,
  barberMemberId: id,
  startAt: instant,
  items: z.array(createAppointmentItemSchema).min(1, { error: 'Agrega al menos un servicio.' }),
  durationOverride: positiveInteger.optional(),
  notes: notes.optional(),
});

export const rescheduleAppointmentSchema = z.object({
  appointmentId: id,
  barberMemberId: id,
  startAt: instant,
  durationOverride: positiveInteger.optional(),
});

export const updateAppointmentNotesSchema = z.object({
  appointmentId: id,
  notes,
});

export const appointmentStatusActionSchema = z.object({
  appointmentId: id,
  status: z
    .enum(APPOINTMENT_STATUSES, { error: 'Selecciona un estado operativo válido.' })
    .exclude(['PENDING', 'COMPLETED']),
});

// Compare zoned whole seconds first, then decimal fractions without Date's millisecond truncation.
function precedes(from: string, to: string): boolean {
  const fraction = /\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/;
  const fromSecond = Date.parse(from.replace(fraction, ''));
  const toSecond = Date.parse(to.replace(fraction, ''));
  if (fromSecond !== toSecond) return fromSecond < toSecond;
  const fromFraction = from.match(fraction)?.[1] ?? '';
  const toFraction = to.match(fraction)?.[1] ?? '';
  const length = Math.max(fromFraction.length, toFraction.length);
  return fromFraction.padEnd(length, '0') < toFraction.padEnd(length, '0');
}

const rangeFields = z.object({ from: instant, to: instant });
export const appointmentRangeSchema = rangeFields.refine(({ from, to }) => precedes(from, to), {
  path: ['to'],
  error: 'El final del rango debe ser posterior al inicio.',
  when: ({ value }) => rangeFields.safeParse(value).success,
});

export type CreateAppointmentItemInput = z.infer<typeof createAppointmentItemSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type UpdateAppointmentNotesInput = z.infer<typeof updateAppointmentNotesSchema>;
export type AppointmentStatusActionInput = z.infer<typeof appointmentStatusActionSchema>;
export type AppointmentRangeInput = z.infer<typeof appointmentRangeSchema>;
