import type { AppointmentError } from '../types/appointment.types';

const messages = {
  APPOINTMENT_NOT_FOUND: 'No se encontró el turno o no está disponible.',
  APPOINTMENT_CONFLICT: 'El horario solicitado no está disponible. Selecciona otro horario.',
  INVALID_APPOINTMENT: 'Revisa los datos del turno e inténtalo nuevamente.',
  APPOINTMENT_ACCESS_DENIED: 'No se pudo acceder al turno.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del turno. Inténtalo nuevamente.',
} as const;

export type AppointmentErrorCode = keyof typeof messages;
export type AppointmentServiceError = AppointmentError<AppointmentErrorCode>;

function failure(code: AppointmentErrorCode): AppointmentServiceError {
  return { code, message: messages[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A public code string is an explicit domain signal (missing detail or failed validation).
 * Technical inputs are SDK errors/responses or caught rejections, never public-code strings.
 * Conflict has no approved RPC identifier yet: do not infer it from SQLSTATE or error prose.
 */
export function mapAppointmentError(error: unknown): AppointmentServiceError | null {
  if (error === null || error === undefined) return null;

  try {
    if (typeof error === 'string' && Object.hasOwn(messages, error)) {
      return failure(error as AppointmentErrorCode);
    }

    if (isRecord(error)) {
      // PostgREST puts HTTP/transport status on its response, not its error object.
      const cause = 'error' in error ? error.error : error;
      if (cause === null || cause === undefined) return null;
      if (error.status === 0) return failure('NETWORK_ERROR');
      if (
        error.status === 401 ||
        error.status === 403 ||
        (isRecord(cause) && cause.code === '42501')
      ) {
        return failure('APPOINTMENT_ACCESS_DENIED');
      }
    }
  } catch {
    // Unknown rejection objects may have throwing accessors; never leak or rethrow them.
    return failure('UNKNOWN_ERROR');
  }

  return failure('UNKNOWN_ERROR');
}
