import { z } from 'zod';
import { createAppointmentSchema, appointmentRangeSchema } from './appointment.schema';
import { appointmentCivilDateSchema } from './appointmentDate.schema';

// Composition fields are local only. The output is exactly the existing create DTO.
const selectedSlot = z
  .object({
    start_at: createAppointmentSchema.shape.startAt,
    end_at: createAppointmentSchema.shape.startAt,
    available: z.literal(true),
  })
  .refine((s) => appointmentRangeSchema.safeParse({ from: s.start_at, to: s.end_at }).success, {
    error: 'Selecciona un horario disponible.',
  });

export const appointmentFormSchema = createAppointmentSchema
  .omit({ startAt: true })
  .extend({
    date: appointmentCivilDateSchema,
    slot: selectedSlot
      .nullable()
      .refine((s) => s !== null, { error: 'Selecciona un horario disponible.' }),
  })
  .transform(({ date: _date, slot, ...input }) => ({ ...input, startAt: slot!.start_at }));

export type AppointmentFormValues = z.input<typeof appointmentFormSchema>;
