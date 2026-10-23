import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { productsKeys } from '@/features/products/constants/productsKeys';

import { salesKeys } from '../constants/salesKeys';
import type { CheckoutCapture } from '../store/checkoutDraftStore';
import type { CompleteCheckoutData } from '../types/checkout.types';
import { sameSaleId } from '../services/checkoutResult';

// Post-commit maintenance only. Never seed normal-RLS reads from the RPC response.
export async function invalidateCheckoutQueries(
  client: QueryClient,
  capture: CheckoutCapture,
  result: CompleteCheckoutData,
): Promise<void> {
  const { scope } = capture;
  if (
    !sameSaleId(scope.businessId, result.sale.business_id) ||
    !sameSaleId(capture.input.operationId, result.sale.operation_id)
  )
    return;
  const scoped = (value: unknown, role = false) => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return (
      candidate.businessId === scope.businessId &&
      candidate.userId === scope.userId &&
      candidate.membershipId === scope.membershipId &&
      (!role || candidate.role === 'OWNER')
    );
  };
  // Replays can return original lines different from the current request.
  const productIds = new Set([
    ...capture.input.items.filter((line) => line.itemType === 'PRODUCT').map((line) => line.itemId),
    ...result.items.flatMap((line) => (line.product_id === null ? [] : [line.product_id])),
  ]);
  const product = (id: unknown) =>
    typeof id === 'string' && [...productIds].some((target) => sameSaleId(target, id));
  const policies: { queryKey: QueryKey; matches: (key: QueryKey) => boolean }[] = [
    {
      queryKey: salesKeys.byBusiness(scope.businessId),
      matches: (key) => scoped(key[3], true) && (key[2] !== 'detail' || key[4] === result.sale.id),
    },
  ];
  if (result.sale.appointment_id !== null)
    policies.push({
      queryKey: appointmentsKeys.byBusiness(scope.businessId),
      matches: (key) =>
        scoped(key[2], true) && (key[3] !== 'detail' || key[4] === result.sale.appointment_id),
    });
  if (productIds.size > 0)
    policies.push(
      {
        queryKey: productsKeys.byBusiness(scope.businessId),
        matches: (key) =>
          scoped(key[3]) && (key[2] === 'list' || (key[2] === 'detail' && product(key[4]))),
      },
      {
        queryKey: inventoryKeys.byBusiness(scope.businessId),
        matches: (key) =>
          key[2] === 'product-stock-batch'
            ? scoped(key[3]) && Array.isArray(key[4]) && key[4].some(product)
            : key[2] === 'low-stock'
              ? scoped(key[3])
              : (key[2] === 'stock' || key[2] === 'movements') && product(key[3]),
      },
    );
  if (result.sale.client_id !== null)
    policies.push({
      queryKey: clientsKeys.stats(scope.businessId, result.sale.client_id, scope.userId, 'OWNER'),
      matches: () => true,
    });
  // Each resource is scheduled once. Both sync throws and async failures are isolated.
  await Promise.allSettled(
    policies.map(async ({ queryKey, matches }) => {
      await client.invalidateQueries({ queryKey, predicate: (query) => matches(query.queryKey) });
    }),
  );
}
