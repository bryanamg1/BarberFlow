import { updateAppointmentNotesSchema } from '../schemas/appointment.schema';
import { appointmentsService } from '../services/appointmentsService';
import { useAppointmentMutation } from './useAppointmentMutation';

export function useUpdateAppointmentNotes() {
  return useAppointmentMutation(
    'notes',
    updateAppointmentNotesSchema,
    appointmentsService.updateNotes,
  );
}
