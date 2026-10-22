import { rescheduleAppointmentSchema } from '../schemas/appointment.schema';
import { appointmentsService } from '../services/appointmentsService';
import { useAppointmentMutation } from './useAppointmentMutation';

export function useRescheduleAppointment() {
  return useAppointmentMutation(
    'reschedule',
    rescheduleAppointmentSchema,
    appointmentsService.reschedule,
  );
}
