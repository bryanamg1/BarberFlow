import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import type { z } from 'zod';

import { appointmentsKeys } from '../constants/appointmentsKeys';
import type { AppointmentErrorCode, AppointmentServiceError } from '../services/appointmentErrors';
import type {
  AppointmentHookResult,
  AppointmentMutationResult,
  AppointmentScope,
  AppointmentState,
} from '../types/appointmentHooks.types';
import type { AppointmentRow } from '../types/appointment.types';
import {
  appointmentHookError,
  readAppointment,
  safeAppointmentHookError,
} from './appointmentQuery';
import { useAppointmentLifecycle } from './useAppointmentLifecycle';

// Local intent/lifecycle only: all authorization and transitions remain in SQL.
export function useAppointmentMutation<TInput extends object, TData extends AppointmentRow>(
  kind: 'create' | 'reschedule' | 'notes' | 'status',
  schema: z.ZodType<TInput>,
  operation: (businessId: string, input: TInput) => Promise<AppointmentHookResult<TData>>,
): AppointmentMutationResult<TInput, TData> {
  type Attempt = {
    scope: AppointmentScope;
    epoch: symbol;
    input: TInput;
    promise: Promise<TData> | null;
    saved: TData | null;
  };
  const lifetime = useAppointmentLifecycle(kind);
  const { scope, epoch } = lifetime;
  const attempt = useRef<Attempt | null>(null);
  const [feedback, setFeedback] = useState<{
    epoch: symbol;
    state: AppointmentState<TData>;
    refreshError: boolean;
  } | null>(null);
  const client = useQueryClient();
  const current = (a: Attempt) =>
    lifetime.isCurrent() && a.epoch === epoch && attempt.current === a;
  useLayoutEffect(() => {
    attempt.current = null;
    return () => {
      attempt.current = null;
    };
  }, [epoch]);
  const fail = (code: AppointmentErrorCode) => Promise.reject<TData>(appointmentHookError(code));
  const publish = (a: Attempt, state: AppointmentState<TData>) => {
    if (current(a)) setFeedback({ epoch, state, refreshError: false });
  };
  const mutation = useMutation<TData, AppointmentServiceError, Attempt>({
    mutationKey: appointmentsKeys.mutation(scope, kind),
    retry: false,
    networkMode: 'always',
    mutationFn: (a) =>
      !current(a)
        ? fail('APPOINTMENT_ACCESS_DENIED')
        : readAppointment(
            () => operation(a.scope.businessId, a.input),
            () => current(a),
          ),
  });
  async function refresh(a: Attempt) {
    if (!current(a)) return;
    let refreshError = false;
    try {
      await client.invalidateQueries(
        {
          queryKey: appointmentsKeys.scope(a.scope),
          predicate: (query) => {
            const key = query.queryKey;
            return (
              key[3] === 'list' ||
              (kind !== 'notes' && key[3] === 'availability') ||
              (key[3] === 'detail' && key[4] === a.saved?.id)
            );
          },
        },
        { throwOnError: true },
      );
    } catch {
      refreshError = true;
    }
    if (current(a)) setFeedback((old) => (old?.epoch === epoch ? { ...old, refreshError } : old));
  }
  function send(a: Attempt): Promise<TData> {
    if (!current(a)) return fail('APPOINTMENT_ACCESS_DENIED');
    if (a.promise) return a.promise;
    if (a.saved) return Promise.resolve(a.saved);
    publish(a, { status: 'pending', data: null, error: null });
    a.promise = mutation
      .mutateAsync(a)
      .then(
        async (data) => {
          if (!current(a)) throw appointmentHookError('APPOINTMENT_ACCESS_DENIED');
          a.saved = data;
          publish(a, { status: 'success', data, error: null });
          await refresh(a);
          if (!current(a)) throw appointmentHookError('APPOINTMENT_ACCESS_DENIED');
          return data;
        },
        (reason: unknown) => {
          if (!current(a)) throw appointmentHookError('APPOINTMENT_ACCESS_DENIED');
          const error = safeAppointmentHookError(reason);
          publish(a, { status: 'error', data: null, error });
          throw error;
        },
      )
      .finally(() => {
        a.promise = null;
      });
    return a.promise;
  }
  function mutateAsync(input: TInput) {
    if (scope === null || !lifetime.isCurrent()) return fail('APPOINTMENT_ACCESS_DENIED');
    const prior = attempt.current;
    if (prior?.promise) return prior.promise;
    const parsed = schema.safeParse(input);
    if (!parsed.success) return fail('INVALID_APPOINTMENT');
    if (prior)
      return JSON.stringify(prior.input) === JSON.stringify(parsed.data)
        ? send(prior)
        : fail('INVALID_APPOINTMENT');
    // Zod builds an independent object, including nested create items.
    const a: Attempt = {
      scope,
      epoch,
      input: Object.freeze(parsed.data),
      promise: null,
      saved: null,
    };
    attempt.current = a;
    return send(a);
  }
  function reset() {
    if (!lifetime.isCurrent() || attempt.current?.promise) return;
    attempt.current = null;
    setFeedback(null);
    mutation.reset();
  }
  const visible = lifetime.isCurrent() && feedback?.epoch === epoch ? feedback : null;
  return {
    ...(visible?.state ?? { status: 'idle' as const, data: null, error: null }),
    mutateAsync,
    reset,
    refreshError: visible?.refreshError ?? false,
    retry: () =>
      !lifetime.isCurrent()
        ? fail('APPOINTMENT_ACCESS_DENIED')
        : attempt.current
          ? send(attempt.current)
          : fail('INVALID_APPOINTMENT'),
    retryReads: async () => {
      if (lifetime.isCurrent() && attempt.current?.saved) await refresh(attempt.current);
    },
  };
}
