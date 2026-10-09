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
import { recoveryIntent } from './recoveryIntent';
import { recoveryRedirectUrl } from './recoveryRedirect';

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

let recoveryExchange: ReturnType<typeof exchangeRecovery> | undefined;
function exchangeRecovery(code: string) {
  return runAuthOperation(async () => {
    if (!code) throw new Error('Invalid recovery callback.');
    const result = await authRepository.completePasswordRecovery({ code });
    if (result.error) return result;
    // The installed SDK supplies this property at runtime; fail closed if it is absent.
    // It originates in the SDK-owned verifier, never in a user-controlled URL parameter.
    if (
      !('redirectType' in result.data) ||
      result.data.redirectType !== 'recovery' ||
      !result.data.session
    ) {
      throw new Error('Invalid recovery callback.');
    }
    recoveryIntent.activate();
    recoveryIntent.isPending();
    return result;
  });
}

export const authService = {
  async requestPasswordRecovery({ email }: { email: string }) {
    let redirectTo: string;
    try {
      redirectTo = recoveryRedirectUrl();
    } catch {
      return {
        data: null,
        error: {
          code: 'UNKNOWN_ERROR' as const,
          message:
            'La recuperación no está configurada para este entorno. Contacta al administrador.',
        },
      };
    }
    return runAuthOperation(() => authRepository.requestPasswordRecovery({ email, redirectTo }));
  },

  completePasswordRecovery({ code }: { code: string }) {
    // A callback's one-use code must not be exchanged twice by Strict Mode effect replay.
    recoveryExchange ??= exchangeRecovery(code).finally(() => {
      recoveryExchange = undefined;
    });
    return recoveryExchange;
  },

  updatePassword({ password }: { password: string }) {
    return runAuthOperation(async () => {
      if (!recoveryIntent.isPending()) throw new Error('Recovery required.');
      const current = await authRepository.getSession();
      if (current.error) return { data: { user: null }, error: current.error };
      if (!current.data.session) {
        recoveryIntent.clear();
        throw new Error('Recovery required.');
      }
      if (!recoveryIntent.isPending()) throw new Error('Recovery required.');
      return authRepository.updatePassword({ password });
    });
  },

  isRecoveryPending(session: Parameters<AuthStateChangeCallback>[1]) {
    if (!session) {
      recoveryIntent.clear();
      return false;
    }
    return recoveryIntent.isPending();
  },

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
      if (!error) recoveryIntent.clear();
      return { data: null, error };
    });
  },

  onAuthStateChange(callback: AuthStateChangeCallback) {
    return authRepository.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) recoveryIntent.activate();
      // Keep the SDK callback synchronous: no Auth requests or awaited SDK locks here.
      callback(event, session);
    });
  },
};
