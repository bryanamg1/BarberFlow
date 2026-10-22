import type { AppointmentErrorCode, AppointmentServiceError } from '../services/appointmentErrors';
import type { AppointmentResult, AppointmentRow } from './appointment.types';

export type AppointmentScope = Readonly<{
  businessId: string;
  userId: string;
  membershipId: string;
  role: 'OWNER' | 'BARBER';
}>;
export type AppointmentHookResult<T> = AppointmentResult<T, AppointmentErrorCode>;
export type AppointmentState<T> =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: AppointmentServiceError };
export type AppointmentQueryResult<T> = AppointmentState<T> & {
  isFetching: boolean;
  refetch: () => Promise<void>;
};
export type AppointmentMutationResult<TInput, TData = AppointmentRow> = AppointmentState<TData> & {
  mutateAsync: (input: TInput) => Promise<TData>;
  retry: () => Promise<TData>;
  reset: () => void;
  refreshError: boolean;
  retryReads: () => Promise<void>;
};
