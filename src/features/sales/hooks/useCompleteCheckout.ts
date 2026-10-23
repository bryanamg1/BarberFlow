import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useBusiness } from '@/features/business/context/BusinessContext';
import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { productsKeys } from '@/features/products/constants/productsKeys';

import { useCheckoutPayment } from './useCheckoutPayment';
import {
  checkoutDraftStore,
  sameCheckoutScope,
  usableCheckoutId,
  type CheckoutCapture,
} from '../store/checkoutDraftStore';
import {
  checkoutError,
  safeCheckoutError,
  uncertainCheckoutError,
} from '../services/checkoutErrors';
import { checkoutService } from '../services/checkoutService';
import type { CheckoutError, CompleteCheckoutData } from '../types/checkout.types';

type State =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'error' | 'uncertain'; data: null; error: CheckoutError }
  | { status: 'success'; data: CompleteCheckoutData; error: null };
const idle: State = { status: 'idle', data: null, error: null };

export function useCompleteCheckout() {
  const model = useCheckoutPayment();
  const business = useBusiness();
  const scope =
    business.status === 'success' && business.data.role === 'OWNER' ? model.scope : null;
  const key = scope ? JSON.stringify(scope) : null;
  const lifetime = useMemo(() => ({ key, epoch: Symbol() }), [key]);
  const live = useRef<typeof lifetime | null>(null);
  const attempt = useRef<{
    capture: CheckoutCapture;
    promise: Promise<CompleteCheckoutData> | null;
  } | null>(null);
  const [scoped, setScoped] = useState<{ epoch: symbol; operationId: string; state: State } | null>(
    null,
  );
  const submission = useStore(checkoutDraftStore, (state) => state.submission);
  const client = useQueryClient();
  const current = (capture: CheckoutCapture) =>
    live.current?.epoch === lifetime.epoch &&
    scope !== null &&
    sameCheckoutScope(scope, capture.scope) &&
    checkoutDraftStore.getState().submission?.capture === capture;
  const mutation = useMutation<CompleteCheckoutData, CheckoutError, CheckoutCapture>({
    retry: false,
    networkMode: 'always',
    mutationFn: async (capture) => {
      if (!current(capture)) throw checkoutError('ACCESS_DENIED');
      const result = await checkoutService.complete(capture.scope.businessId, capture.input);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  useLayoutEffect(() => {
    live.current = lifetime;
    return () => {
      live.current = null;
      // Leaving a running request is not rollback. A remount may retry only this capture.
      const capture = attempt.current?.capture;
      if (capture) checkoutDraftStore.getState().settleCapture(capture, 'uncertain');
    };
  }, [lifetime]);
  function setState(capture: CheckoutCapture, state: State) {
    setScoped({ epoch: lifetime.epoch, operationId: capture.input.operationId, state });
  }
  function refresh(data: CompleteCheckoutData, capture: CheckoutCapture) {
    const keys: (readonly unknown[])[] = [];
    if (data.items.some((line) => line.item_type === 'PRODUCT'))
      keys.push(
        inventoryKeys.byBusiness(capture.scope.businessId),
        productsKeys.byBusiness(capture.scope.businessId),
      );
    if (data.sale.appointment_id) keys.push(appointmentsKeys.byBusiness(capture.scope.businessId));
    for (const queryKey of keys) {
      // Confirmed writes survive maintenance failures, including synchronous client errors.
      void Promise.resolve()
        .then(() => client.invalidateQueries({ queryKey }))
        .catch(() => undefined);
    }
  }
  function send(capture: CheckoutCapture): Promise<CompleteCheckoutData> {
    if (!current(capture)) return Promise.reject(checkoutError('ACCESS_DENIED'));
    if (attempt.current?.capture === capture && attempt.current.promise)
      return attempt.current.promise;
    const value = { capture, promise: null as Promise<CompleteCheckoutData> | null };
    attempt.current = value;
    setState(capture, { status: 'pending', data: null, error: null });
    value.promise = mutation
      .mutateAsync(capture)
      .then(
        (data) => {
          if (!current(capture)) throw checkoutError('ACCESS_DENIED');
          if (!checkoutDraftStore.getState().settleCapture(capture, 'success'))
            throw checkoutError('ACCESS_DENIED');
          setState(capture, { status: 'success', data, error: null });
          refresh(data, capture);
          try {
            router.replace({ pathname: '/sales/[id]', params: { id: data.sale.id } });
          } catch {
            /* The confirmed result remains visible with a manual detail link. */
          }
          return data;
        },
        (reason) => {
          const error = safeCheckoutError(reason);
          if (current(capture)) {
            const uncertain = uncertainCheckoutError(error);
            checkoutDraftStore
              .getState()
              .settleCapture(capture, uncertain ? 'uncertain' : 'rejected');
            setState(capture, { status: uncertain ? 'uncertain' : 'error', data: null, error });
          }
          throw error;
        },
      )
      .finally(() => {
        value.promise = null;
      });
    return value.promise;
  }
  function submit() {
    if (attempt.current?.promise && current(attempt.current.capture))
      return attempt.current.promise;
    const state = checkoutDraftStore.getState();
    if (
      !scope ||
      live.current?.epoch !== lifetime.epoch ||
      !model.eligible ||
      !model.draft ||
      state.draft !== model.draft ||
      !sameCheckoutScope(scope, state.scope)
    )
      return Promise.reject(checkoutError('INVALID_INPUT'));
    const capture = state.captureIntent(scope, model.draft.operationId);
    return capture ? send(capture) : Promise.reject(checkoutError('INVALID_INPUT'));
  }
  function retry() {
    const active = checkoutDraftStore.getState().submission;
    if (attempt.current?.promise && current(attempt.current.capture))
      return attempt.current.promise;
    if (
      !active ||
      !current(active.capture) ||
      !checkoutDraftStore.getState().retryCapture(active.capture)
    )
      return Promise.reject(checkoutError('INVALID_INPUT'));
    return send(active.capture);
  }
  function editRejected(newOperationId: string) {
    const state = checkoutDraftStore.getState(),
      active = state.submission,
      draft = state.draft;
    if (
      !active ||
      active.status !== 'rejected' ||
      !draft ||
      !current(active.capture) ||
      !usableCheckoutId(newOperationId) ||
      newOperationId === draft.operationId
    )
      return false;
    const capturedScope = active.capture.scope;
    state.clearDraft(capturedScope, draft.operationId);
    checkoutDraftStore.getState().startDraft(capturedScope, newOperationId, {
      appointmentId: draft.appointmentId,
      clientId: draft.clientId,
    });
    for (const line of draft.items)
      checkoutDraftStore
        .getState()
        .addLine(capturedScope, newOperationId, line, capturedScope.businessId);
    checkoutDraftStore.getState().patchDraft(capturedScope, newOperationId, {
      discountAmount: draft.discountAmount,
      paymentMethod: draft.paymentMethod,
    });
    attempt.current = null;
    setScoped(null);
    return true;
  }
  const visible =
    scoped?.epoch === lifetime.epoch &&
    (!model.draft || scoped.operationId === model.draft.operationId)
      ? scoped.state
      : idle;
  const active =
    scope && submission && sameCheckoutScope(scope, submission.capture.scope) ? submission : null;
  const state: State =
    active?.status === 'pending'
      ? { status: 'pending', data: null, error: null }
      : active?.status === 'uncertain'
        ? {
            status: 'uncertain',
            data: null,
            error: visible.error ?? checkoutError('UNKNOWN_ERROR'),
          }
        : active?.status === 'rejected'
          ? { status: 'error', data: null, error: visible.error ?? checkoutError('INVALID_INPUT') }
          : visible;
  return {
    ...state,
    scope,
    draft: model.draft,
    eligible: scope !== null && model.eligible && active === null,
    submit,
    retry,
    editRejected,
  };
}
