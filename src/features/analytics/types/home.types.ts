import type { AppointmentRow } from '@/features/appointments/types/appointment.types';

export type HomeNextAppointmentResult =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | { status: 'success'; data: AppointmentRow | null };
