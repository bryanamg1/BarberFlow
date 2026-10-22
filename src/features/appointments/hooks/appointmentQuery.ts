import type { UseQueryResult } from '@tanstack/react-query';

import {
  mapAppointmentError,
  type AppointmentErrorCode,
  type AppointmentServiceError,
} from '../services/appointmentErrors';
import type {
  AppointmentHookResult,
  AppointmentQueryResult,
} from '../types/appointmentHooks.types';

export const appointmentHookError = (code: AppointmentErrorCode) => mapAppointmentError(code)!;
export function safeAppointmentHookError(error: unknown): AppointmentServiceError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    const mapped = mapAppointmentError(error.code);
    if (mapped) return mapped;
  }
  return appointmentHookError('UNKNOWN_ERROR');
}
export async function readAppointment<T>(
  operation: () => Promise<AppointmentHookResult<T>>,
  current: () => boolean,
): Promise<T> {
  if (!current()) throw appointmentHookError('APPOINTMENT_ACCESS_DENIED');
  let result: AppointmentHookResult<T>;
  try {
    result = await operation();
  } catch {
    throw appointmentHookError('UNKNOWN_ERROR');
  }
  if (!current()) throw appointmentHookError('APPOINTMENT_ACCESS_DENIED');
  if (result.error !== null) throw safeAppointmentHookError(result.error);
  return result.data;
}
export function appointmentQueryState<T>(
  query: UseQueryResult<T, AppointmentServiceError>,
  active: boolean,
  valid: boolean,
  refetch: () => Promise<void>,
): AppointmentQueryResult<T> {
  const actions = { refetch, isFetching: active && valid && query.isFetching };
  if (!active) return { ...actions, status: 'idle', data: null, error: null };
  if (!valid)
    return {
      ...actions,
      status: 'error',
      data: null,
      error: appointmentHookError('INVALID_APPOINTMENT'),
    };
  if (query.isError) return { ...actions, status: 'error', data: null, error: query.error };
  if (query.isSuccess) return { ...actions, status: 'success', data: query.data, error: null };
  return { ...actions, status: 'pending', data: null, error: null };
}
