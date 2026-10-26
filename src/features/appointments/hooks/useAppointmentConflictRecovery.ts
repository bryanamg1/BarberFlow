import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { appointmentsKeys } from '../constants/appointmentsKeys';
import type { AppointmentAvailabilityInput } from '../types/appointment.types';
import { useAppointmentLifecycle } from './useAppointmentLifecycle';

// Cache coordination only. BF164 owns the sole availability reader and its retry UI.
export function useAppointmentConflictRecovery(
  input: AppointmentAvailabilityInput | null,
  timezone: string,
  intentKey = JSON.stringify(input),
) {
  const client = useQueryClient();
  // A transient loading duration must not erase feedback for the same user inputs.
  const lifetime = useAppointmentLifecycle(JSON.stringify(['conflict', intentKey, timezone]));
  const [feedback, setFeedback] = useState<{ epoch: symbol; refreshError: boolean } | null>(null);
  const key = [...appointmentsKeys.availability(lifetime.scope, input), timezone];
  async function recover() {
    if (!input || !lifetime.isCurrent()) return;
    setFeedback({ epoch: lifetime.epoch, refreshError: false });
    try {
      // Prevent an older in-flight response from making the rejected slot fresh again.
      await client.cancelQueries({ queryKey: key, exact: true });
      if (!lifetime.isCurrent()) return;
      // The pending form has unmounted its selector. Mark stale now; its normal
      // remount fetches with a live observer instead of invoking an unmounted queryFn.
      await client.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
    } catch {
      if (lifetime.isCurrent()) setFeedback({ epoch: lifetime.epoch, refreshError: true });
    }
  }
  async function retryReads() {
    if (!input || !lifetime.isCurrent()) return;
    try {
      await client.invalidateQueries(
        { queryKey: key, exact: true, refetchType: 'active' },
        { throwOnError: true },
      );
      if (lifetime.isCurrent()) setFeedback({ epoch: lifetime.epoch, refreshError: false });
    } catch {
      if (lifetime.isCurrent()) setFeedback({ epoch: lifetime.epoch, refreshError: true });
    }
  }
  const visible = lifetime.isCurrent() && feedback?.epoch === lifetime.epoch ? feedback : null;
  return {
    conflicted: visible !== null,
    refreshError: visible?.refreshError ?? false,
    recover,
    retryReads,
    reset: () => {
      if (lifetime.isCurrent()) setFeedback(null);
    },
  };
}
