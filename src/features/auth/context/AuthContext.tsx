import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { authService } from '../services/authService';
import type { AuthServiceError } from '../types/auth.types';

type AuthSnapshot =
  | { status: 'initializing'; session: null; error: null }
  | { status: 'authenticated'; session: Session; error: null }
  | { status: 'recovering'; session: Session; error: null }
  | { status: 'unauthenticated'; session: null; error: null }
  | { status: 'error'; session: null; error: AuthServiceError };

export type AuthState =
  | Readonly<Extract<AuthSnapshot, { session: Session }> & { user: User }>
  | Readonly<Exclude<AuthSnapshot, { session: Session }> & { user: null }>;

const AuthContext = createContext<AuthState | undefined>(undefined);

function sessionSnapshot(session: Session | null): AuthSnapshot {
  const recovering = authService.isRecoveryPending(session);
  return session
    ? { status: recovering ? 'recovering' : 'authenticated', session, error: null }
    : { status: 'unauthenticated', session: null, error: null };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    status: 'initializing',
    session: null,
    error: null,
  });

  useEffect(() => {
    let disposed = false;
    let eventReceived = false;
    let subscription: ReturnType<typeof authService.onAuthStateChange> | undefined;

    async function initialize() {
      try {
        subscription = authService.onAuthStateChange((_event, session) => {
          if (disposed) return;
          eventReceived = true;
          try {
            setSnapshot(sessionSnapshot(session));
          } catch {
            setSnapshot({
              status: 'error',
              session: null,
              error: {
                code: 'UNKNOWN_ERROR',
                message: 'No se pudo verificar la sesión. Inténtalo nuevamente.',
              },
            });
          }
        });

        const result = await authService.getSession();
        // An Auth event is newer evidence than the startup read, even if that read fails.
        if (disposed || eventReceived) return;

        setSnapshot(
          result.error
            ? {
                status: 'error',
                session: null,
                error: { code: result.error.code, message: result.error.message },
              }
            : sessionSnapshot(result.data.session),
        );
      } catch {
        if (!disposed && !eventReceived) {
          setSnapshot({
            status: 'error',
            session: null,
            error: {
              code: 'UNKNOWN_ERROR',
              message: 'No se pudo completar la operación. Inténtalo nuevamente.',
            },
          });
        }
      }
    }

    void initialize();

    return () => {
      disposed = true;
      subscription?.unsubscribe();
    };
  }, []);

  // User is derived on render, never stored or updated separately from the session.
  const state: AuthState =
    snapshot.session !== null
      ? { ...snapshot, user: snapshot.session.user }
      : { ...snapshot, user: null };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (state === undefined) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.');
  }
  return state;
}
