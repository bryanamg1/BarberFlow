import { appointmentStatusActionSchema } from '../schemas/appointment.schema';
import { appointmentsService } from '../services/appointmentsService';
import { useAppointmentMutation } from './useAppointmentMutation';

export function useAppointmentStatusAction() {
  return useAppointmentMutation(
    'status',
    appointmentStatusActionSchema,
    appointmentsService.changeStatus,
  );
}
