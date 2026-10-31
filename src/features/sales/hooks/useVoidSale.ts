import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';
import { useLayoutEffect, useRef, useState } from 'react';
import { salesKeys } from '../constants/salesKeys';
import { salesService } from '../services/salesService';
import { saleCorrectionError, voidSaleSchema } from '../services/saleCorrection';
import { sameSaleId } from '../services/checkoutResult';
import type { SaleDetail } from '../types/saleDetail.types';
import type {
  SaleCorrectionError,
  VoidSaleData,
  VoidSaleInput,
} from '../types/saleCorrection.types';
import { invalidateSaleCorrectionQueries } from '../utils/invalidateCheckoutQueries';
import { useSaleLifecycle } from './useSaleLifecycle';

type State =
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: VoidSaleData; error: null }
  | { status: 'error'; data: null; error: SaleCorrectionError };
type Attempt = {
  input: VoidSaleInput;
  promise: Promise<VoidSaleData> | null;
  saved: VoidSaleData | null;
  epoch: symbol;
};
const idle: State = { status: 'idle', data: null, error: null };
export function useVoidSale(saleId: string | null, sale: SaleDetail | null, eligible: boolean) {
  const lifetime = useSaleLifecycle(saleId),
    { scope } = lifetime;
  const client = useQueryClient();
  const attempt = useRef<Attempt | null>(null);
  const completed = useRef(false);
  const allowed = useRef(false);
  const [feedback, setFeedback] = useState<{ epoch: symbol; state: State } | null>(null);
  useLayoutEffect(() => {
    allowed.current =
      eligible &&
      scope?.role === 'OWNER' &&
      sale?.status === 'COMPLETED' &&
      saleId !== null &&
      sameSaleId(sale.id, saleId);
    return () => {
      allowed.current = false;
    };
  }, [eligible, scope?.role, sale?.status, sale?.id, saleId]);
  useLayoutEffect(() => {
    attempt.current = null;
    completed.current = false;
    return () => {
      attempt.current = null;
    };
  }, [lifetime.epoch]);
  const current = (a: Attempt) =>
    lifetime.isCurrent() &&
    a.epoch === lifetime.epoch &&
    attempt.current === a &&
    scope?.role === 'OWNER';
  const publish = (a: Attempt, state: State) => {
    if (current(a)) setFeedback({ epoch: a.epoch, state });
  };
  const mutation = useMutation<VoidSaleData, SaleCorrectionError, Attempt>({
    retry: false,
    networkMode: 'always',
    mutationFn: async (a) => {
      if (!current(a) || !allowed.current || !scope) throw saleCorrectionError('ACCESS_DENIED');
      const result = await salesService.voidSale(scope.businessId, a.input);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  const fail = (code: SaleCorrectionError['code']) =>
    Promise.reject<VoidSaleData>(saleCorrectionError(code));
  function send(a: Attempt): Promise<VoidSaleData> {
    if (!current(a)) return fail('ACCESS_DENIED');
    if (a.promise) return a.promise;
    if (a.saved) return Promise.resolve(a.saved);
    if (!allowed.current) return fail('ACCESS_DENIED');
    publish(a, { status: 'pending', data: null, error: null });
    a.promise = mutation
      .mutateAsync(a)
      .then(
        (data) => {
          if (!current(a) || !scope || !sale) throw saleCorrectionError('ACCESS_DENIED');
          a.saved = data;
          completed.current = true;
          publish(a, { status: 'success', data, error: null });
          // Keep privileged children local to this OWNER lifetime, never seed BF197's RLS cache.
          void client
            .cancelQueries({ queryKey: salesKeys.correction(scope, sale.id), exact: true })
            .then(() => {
              if (!current(a)) return;
              client.setQueryData(salesKeys.correction(scope, sale.id), {
                correction: data.correction,
                stockMovements: data.stockMovements,
              });
              return invalidateSaleCorrectionQueries({
                scope,
                sale,
                correctionResult: data,
                queryClient: client,
                isCurrent: () => current(a),
              });
            })
            .catch(() => undefined)
            .finally(() => {
              if (attempt.current === a) attempt.current = null;
            });
          return data;
        },
        (reason: unknown) => {
          if (!current(a)) throw saleCorrectionError('ACCESS_DENIED');
          const code =
            typeof reason === 'object' && reason !== null && 'code' in reason ? reason.code : null;
          const codes: SaleCorrectionError['code'][] = [
            'ACCESS_DENIED',
            'NOT_FOUND',
            'INVALID_STATUS',
            'INVALID_INPUT',
            'CONFLICT',
            'INCOMPLETE_HISTORY',
            'NETWORK_ERROR',
            'UNKNOWN_ERROR',
          ];
          const error = saleCorrectionError(
            codes.includes(code as SaleCorrectionError['code'])
              ? (code as SaleCorrectionError['code'])
              : 'UNKNOWN_ERROR',
          );
          publish(a, { status: 'error', data: null, error });
          throw error;
        },
      )
      .finally(() => {
        a.promise = null;
      });
    return a.promise;
  }
  function confirm(reason: string) {
    if (!lifetime.isCurrent() || !allowed.current || !sale || scope?.role !== 'OWNER')
      return fail('ACCESS_DENIED');
    const old = attempt.current;
    if (completed.current) return fail('INVALID_STATUS');
    if (old?.promise) return old.promise;
    if (reason.trim().length === 0) return fail('INVALID_INPUT');
    if (old && old.input.reason === reason) return send(old);
    const parsed = voidSaleSchema.safeParse({ saleId: sale.id, operationId: uuid.v4(), reason });
    if (!parsed.success) return fail('INVALID_INPUT');
    const a: Attempt = {
      input: Object.freeze(parsed.data),
      promise: null,
      saved: null,
      epoch: lifetime.epoch,
    };
    attempt.current = a;
    return send(a);
  }
  function reset() {
    if (
      !lifetime.isCurrent() ||
      completed.current ||
      attempt.current?.promise ||
      attempt.current?.saved
    )
      return;
    attempt.current = null;
    setFeedback(null);
  }
  const state = feedback?.epoch === lifetime.epoch ? feedback.state : idle;
  return { ...state, confirm, reset };
}
