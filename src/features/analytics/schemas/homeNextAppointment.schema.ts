import { z } from 'zod';

import { rescheduleAppointmentSchema } from '@/features/appointments/schemas/appointment.schema';
import { appointmentInstantPrecedes } from '@/features/appointments/utils/appointmentInstant';

const id = rescheduleAppointmentSchema.shape.appointmentId;
const instant = rescheduleAppointmentSchema.shape.startAt;

export const homeNextAppointmentSchema = z
  .object({
    id,
    business_id: id,
    client_id: id,
    barber_member_id: id,
    start_at: instant,
    end_at: instant,
    status: z.enum(['PENDING', 'CONFIRMED']),
    notes: z.string().nullable(),
    created_by: id,
    created_at: instant,
    updated_at: instant,
  })
  .refine((row) => appointmentInstantPrecedes(row.start_at, row.end_at));
