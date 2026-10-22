import { createAppointmentSchema } from '../schemas/appointment.schema';
import { appointmentsService } from '../services/appointmentsService';
import { useAppointmentMutation } from './useAppointmentMutation';

export function useCreateAppointment() {
  return useAppointmentMutation('create', createAppointmentSchema, appointmentsService.create);
}
