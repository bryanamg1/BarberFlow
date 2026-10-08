import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js';

import {
  authRepository,
  type AuthStateChangeCallback,
  type SignInCredentials,
} from '../repositories/authRepository';
import type { AuthErrorCode, AuthResult, AuthServiceError } from '../types/auth.types';

const errorMessages: Record<AuthErrorCode, string> = {
  AUTH_INVALID_CREDENTIALS: 'El correo o la contraseña son incorrectos.',
  AUTH_SESSION_EXPIRED: 'La sesión venció o ya no es válida. Inicia sesión nuevamente.',
  AUTH_UNAUTHORIZED: 'Inicia sesión para continuar.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación. Inténtalo nuevamente.',
};

function normalizeAuthError(error: unknown): AuthServiceError {
  let code: AuthErrorCode = 'UNKNOWN_ERROR';

  if (isAuthRetryableFetchError(error)) {
    code = 'NETWORK_ERROR';
  } else if (isAuthSessionMissingError(error)) {
    code = 'AUTH_UNAUTHORIZED';
  } else if (isAuthError(error)) {
    if (error.code === 'invalid_credentials' || error.name === 'AuthInvalidCredentialsError') {
      code = 'AUTH_INVALID_CREDENTIALS';
    } else if (error.code === 'no_authorization') {
      code = 'AUTH_UNAUTHORIZED';
    } else if (
      error.code === 'bad_jwt' ||
      error.code === 'invalid_jwt' ||
      error.code === 'session_expired' ||
      error.code === 'session_not_found' ||
      error.code === 'refresh_token_not_found' ||
      error.code === 'refresh_token_already_used'
    ) {
      code = 'AUTH_SESSION_EXPIRED';
    }
  }

  return { code, message: errorMessages[code] };
}

async function runAuthOperation<T extends { data: unknown; error: unknown }>(
  operation: () => Promise<T>,
): Promise<AuthResult<T['data']>> {
  try {
    const { data, error } = await operation();
    return error === null
      ? { data, error: null }
      : { data: null, error: normalizeAuthError(error) };
  } catch (error: unknown) {
    return { data: null, error: normalizeAuthError(error) };
  }
}

export const authService = {
  signInWithPassword(credentials: SignInCredentials) {
    return runAuthOperation(() => authRepository.signInWithPassword(credentials));
  },

  // A null local session is a successful read, not an authorization decision.
  getSession() {
    return runAuthOperation(() => authRepository.getSession());
  },

  getUser() {
    return runAuthOperation(() => authRepository.getUser());
  },

  signOut() {
    return runAuthOperation(async () => {
      const { error } = await authRepository.signOut();
      return { data: null, error };
    });
  },

  onAuthStateChange(callback: AuthStateChangeCallback) {
    return authRepository.onAuthStateChange(callback);
  },
};
