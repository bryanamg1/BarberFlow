import { rescheduleAppointmentSchema } from '@/features/appointments/schemas/appointment.schema';
import {
  mapAppointmentError,
  type AppointmentErrorCode,
} from '@/features/appointments/services/appointmentErrors';
import type {
  AppointmentResult,
  AppointmentRow,
} from '@/features/appointments/types/appointment.types';

import { homeRepository } from '../repositories/homeRepository';
import { homeNextAppointmentSchema } from '../schemas/homeNextAppointment.schema';

export const homeService = {
  async getNextAppointment(
    businessId: string,
    signal?: AbortSignal,
  ): Promise<AppointmentResult<AppointmentRow | null, AppointmentErrorCode>> {
    const failed = (error: unknown) => ({
      data: null,
      error: mapAppointmentError(error) ?? mapAppointmentError('UNKNOWN_ERROR')!,
    });
    if (!rescheduleAppointmentSchema.shape.appointmentId.safeParse(businessId).success)
      return failed('INVALID_APPOINTMENT');
    try {
      const response = await homeRepository.getNextAppointment(businessId, signal);
      if (response.error !== null) return failed(response);
      if (response.data === null) return { data: null, error: null };
      const parsed = homeNextAppointmentSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.business_id !== businessId)
        return failed('INVALID_APPOINTMENT');
      return { data: parsed.data, error: null };
    } catch (error: unknown) {
      return failed(typeof error === 'string' ? { error } : error);
    }
  },
};
