import { z } from 'zod';

import { appointmentsRepository } from '../repositories/appointmentsRepository';
import {
  appointmentRangeSchema,
  appointmentStatusActionSchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentNotesSchema,
  type AppointmentStatusActionInput,
  type CreateAppointmentInput,
  type RescheduleAppointmentInput,
  type UpdateAppointmentNotesInput,
} from '../schemas/appointment.schema';
import { appointmentCivilDateSchema } from '../schemas/appointmentDate.schema';
import type {
  AppointmentAvailabilityInput,
  AppointmentRange,
  AppointmentResult,
} from '../types/appointment.types';
import {
  mapAppointmentError,
  type AppointmentErrorCode,
  type AppointmentServiceError,
} from './appointmentErrors';

const idSchema = rescheduleAppointmentSchema.shape.appointmentId;
const availabilitySchema = z.object({
  barberMemberId: rescheduleAppointmentSchema.shape.barberMemberId,
  date: appointmentCivilDateSchema,
  durationMinutes: rescheduleAppointmentSchema.shape.durationOverride.unwrap(),
  excludeAppointmentId: idSchema.optional(),
});

function failure(error: unknown): { data: null; error: AppointmentServiceError } {
  return {
    data: null,
    // An explicit known code always maps to a safe error; nullish unexpected failures do not.
    error: mapAppointmentError(error) ?? mapAppointmentError('UNKNOWN_ERROR')!,
  };
}

async function run<TInput, TData>(
  businessId: string,
  input: TInput,
  schema: z.ZodType<TInput>,
  operation: (
    businessId: string,
    input: TInput,
  ) => PromiseLike<{ data: TData | null; error: unknown; status: number }>,
  nullCode: 'APPOINTMENT_NOT_FOUND' | 'UNKNOWN_ERROR' = 'UNKNOWN_ERROR',
): Promise<AppointmentResult<TData, AppointmentErrorCode>> {
  try {
    const tenant = idSchema.safeParse(businessId);
    const parsed = schema.safeParse(input);
    if (!tenant.success || !parsed.success) return failure('INVALID_APPOINTMENT');

    const result = await operation(tenant.data, parsed.data);
    if (result.error !== null) return failure(result);
    if (result.data === undefined) return failure('UNKNOWN_ERROR');
    if (result.data === null) return failure(nullCode);
    return { data: result.data, error: null };
  } catch (error: unknown) {
    // Rejected strings are technical failures, not deliberate domain-code signals.
    return failure(typeof error === 'string' ? { error } : error);
  }
}

export const appointmentsService = {
  listByRange(businessId: string, range: AppointmentRange) {
    return run(businessId, range, appointmentRangeSchema, appointmentsRepository.listByRange);
  },

  getById(businessId: string, appointmentId: string) {
    return run(
      businessId,
      appointmentId,
      idSchema,
      appointmentsRepository.getById,
      'APPOINTMENT_NOT_FOUND',
    );
  },

  getAvailability(businessId: string, input: AppointmentAvailabilityInput) {
    return run(businessId, input, availabilitySchema, appointmentsRepository.getAvailability);
  },

  create(businessId: string, input: CreateAppointmentInput) {
    return run(businessId, input, createAppointmentSchema, appointmentsRepository.create);
  },

  reschedule(businessId: string, input: RescheduleAppointmentInput) {
    return run(businessId, input, rescheduleAppointmentSchema, appointmentsRepository.reschedule);
  },

  updateNotes(businessId: string, input: UpdateAppointmentNotesInput) {
    return run(businessId, input, updateAppointmentNotesSchema, appointmentsRepository.updateNotes);
  },

  changeStatus(businessId: string, input: AppointmentStatusActionInput) {
    return run(
      businessId,
      input,
      appointmentStatusActionSchema,
      appointmentsRepository.changeStatus,
    );
  },
};
