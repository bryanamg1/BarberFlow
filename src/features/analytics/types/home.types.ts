import type { AppointmentRow } from '@/features/appointments/types/appointment.types';
import type { FinanceDashboardSummary } from './finance.types';

export type HomeDashboardSummaryResult =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | { status: 'success'; data: FinanceDashboardSummary };

export type HomeNextAppointmentResult =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unavailable' }
  | { status: 'success'; data: AppointmentRow | null };
