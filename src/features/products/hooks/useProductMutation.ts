import type {
  ProductError,
  ProductMutationResult,
  ProductScope,
  ProductState,
} from '../types/productHooks.types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';

import { productsKeys } from '../constants/productsKeys';
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '../schemas/product.schema';
import { productsService } from '../services/productsService';
import type { ProductRow } from '../types/product.types';
import { productError, safeProductError } from '../utils/productErrors';
import { readProduct } from './productQuery';
import { usableProductId, useProductLifecycle } from './useProductLifecycle';

type Attempt = {
  scope: ProductScope;
  epoch: symbol;
  input: UpdateProductInput;
  productId: string | null;
  promise: Promise<ProductRow> | null;
  saved: ProductRow | null;
};
const idle: ProductState<ProductRow> = { status: 'idle', data: null, error: null };

// Internal lifecycle for the two approved catalog writes.
export function useProductMutation(
  kind: 'create' | 'update',
  productId: string | null,
): ProductMutationResult<UpdateProductInput> {
  const lifetime = useProductLifecycle(JSON.stringify({ kind, productId }), true);
  const { scope, epoch } = lifetime;
  const attempt = useRef<Attempt | null>(null);
  const [feedback, setFeedback] = useState<{
    epoch: symbol;
    state: ProductState<ProductRow>;
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
  const publish = (a: Attempt, state: ProductState<ProductRow>) => {
    if (current(a)) setFeedback({ epoch, state, refreshError: false });
  };
  const fail = (code: ProductError['code']) => Promise.reject<ProductRow>(productError(code));
  const mutation = useMutation<ProductRow, ProductError, Attempt>({
    retry: false,
    // Do not queue a captured catalog write across connectivity/context changes.
    networkMode: 'always',
    mutationFn: (a) => {
      if (!current(a)) return fail('PRODUCT_ACCESS_DENIED');
      return readProduct(
        () =>
          kind === 'create'
            ? productsService.create(a.scope.businessId, a.input as CreateProductInput)
            : productsService.update(a.scope.businessId, a.productId!, a.input),
        () => current(a),
      );
    },
  });
  async function refresh(a: Attempt) {
    if (!current(a)) return;
    try {
      // One real prefix covers list AND affected detail; no duplicate refetch,
      // category mutation or invented Finance/Analytics key.
      await client.invalidateQueries(
        { queryKey: productsKeys.byBusiness(a.scope.businessId) },
        { throwOnError: true },
      );
      if (current(a))
        setFeedback((old) => (old?.epoch === epoch ? { ...old, refreshError: false } : old));
    } catch {
      if (current(a))
        setFeedback((old) => (old?.epoch === epoch ? { ...old, refreshError: true } : old));
    }
  }
  function send(a: Attempt): Promise<ProductRow> {
    if (!current(a)) return fail('PRODUCT_ACCESS_DENIED');
    if (a.promise) return a.promise;
    if (a.saved) return Promise.resolve(a.saved);
    publish(a, { status: 'pending', data: null, error: null });
    a.promise = mutation
      .mutateAsync(a)
      .then(
        async (data) => {
          if (!current(a)) throw productError('PRODUCT_ACCESS_DENIED');
          a.saved = data;
          publish(a, { status: 'success', data, error: null });
          await refresh(a);
          if (!current(a)) throw productError('PRODUCT_ACCESS_DENIED');
          return data;
        },
        (reason: unknown) => {
          if (!current(a)) throw productError('PRODUCT_ACCESS_DENIED');
          const error = safeProductError(reason);
          publish(a, { status: 'error', data: null, error });
          throw error;
        },
      )
      .finally(() => {
        a.promise = null;
      });
    return a.promise;
  }
  function mutateAsync(input: UpdateProductInput) {
    if (scope === null || !lifetime.isCurrent()) return fail('PRODUCT_ACCESS_DENIED');
    if (kind === 'update' && !usableProductId(productId)) return fail('INVALID_INPUT');
    const previous = attempt.current;
    if (previous?.promise) return previous.promise;
    const parsed = (kind === 'create' ? createProductSchema : updateProductSchema).safeParse(input);
    if (!parsed.success) return fail('INVALID_INPUT');
    if (previous)
      return JSON.stringify(previous.input) === JSON.stringify(parsed.data)
        ? send(previous)
        : fail('INVALID_INPUT');
    const a: Attempt = {
      scope,
      epoch,
      productId,
      input: Object.freeze({ ...parsed.data }),
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
    ...(visible?.state ?? idle),
    refreshError: visible?.refreshError ?? false,
    mutateAsync,
    reset,
    retry: () =>
      !lifetime.isCurrent()
        ? fail('PRODUCT_ACCESS_DENIED')
        : attempt.current
          ? send(attempt.current)
          : fail('INVALID_INPUT'),
    retryReads: async () => {
      if (lifetime.isCurrent() && attempt.current?.saved) await refresh(attempt.current);
    },
  };
}
