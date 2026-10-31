import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { appointmentsKeys } from '@/features/appointments/constants/appointmentsKeys';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import { inventoryKeys } from '@/features/inventory/constants/inventoryKeys';
import { productsKeys } from '@/features/products/constants/productsKeys';
import { analyticsKeys } from '@/features/analytics/constants/analyticsKeys';

import { salesKeys } from '../constants/salesKeys';
import type { CheckoutCapture } from '../store/checkoutDraftStore';
import type { CompleteCheckoutData, SaleRow } from '../types/checkout.types';
import { sameSaleId } from '../services/checkoutResult';
import type { SaleScope, VoidSaleData } from '../types/saleCorrection.types';

type Policy = { queryKey: QueryKey; matches: (key: QueryKey) => boolean };
function matchesScope(scope: CheckoutCapture['scope'], value: unknown, role = false) {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.businessId === scope.businessId &&
    candidate.userId === scope.userId &&
    candidate.membershipId === scope.membershipId &&
    (!role || candidate.role === 'OWNER')
  );
}
function productPolicies(scope: CheckoutCapture['scope'], ids: Set<string>): Policy[] {
  if (ids.size === 0) return [];
  const product = (id: unknown) =>
    typeof id === 'string' && [...ids].some((target) => sameSaleId(target, id));
  return [
    {
      queryKey: productsKeys.byBusiness(scope.businessId),
      matches: (key) =>
        matchesScope(scope, key[3]) &&
        (key[2] === 'list' || (key[2] === 'detail' && product(key[4]))),
    },
    {
      queryKey: inventoryKeys.byBusiness(scope.businessId),
      matches: (key) =>
        key[2] === 'product-stock-batch'
          ? matchesScope(scope, key[3]) && Array.isArray(key[4]) && key[4].some(product)
          : key[2] === 'low-stock'
            ? matchesScope(scope, key[3])
            : (key[2] === 'stock' || key[2] === 'movements') && product(key[3]),
    },
  ];
}
async function invalidatePolicies(client: QueryClient, policies: Policy[], isCurrent = () => true) {
  await Promise.allSettled(
    policies.map(async ({ queryKey, matches }) => {
      if (isCurrent())
        await client.invalidateQueries({ queryKey, predicate: (query) => matches(query.queryKey) });
    }),
  );
}

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
  const scoped = (value: unknown, role = false) => matchesScope(scope, value, role);
  // Replays can return original lines different from the current request.
  const productIds = new Set([
    ...capture.input.items.filter((line) => line.itemType === 'PRODUCT').map((line) => line.itemId),
    ...result.items.flatMap((line) => (line.product_id === null ? [] : [line.product_id])),
  ]);
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
  policies.push(...productPolicies(scope, productIds));
  if (result.sale.client_id !== null)
    policies.push({
      queryKey: clientsKeys.stats(scope.businessId, result.sale.client_id, scope.userId, 'OWNER'),
      matches: () => true,
    });
  // Each resource is scheduled once. Both sync throws and async failures are isolated.
  await invalidatePolicies(client, policies);
}

// Correction has its own operation ID. It never impersonates a checkout capture.
export async function invalidateSaleCorrectionQueries({
  scope,
  sale,
  correctionResult,
  queryClient,
  isCurrent = () => true,
}: {
  scope: SaleScope;
  sale: SaleRow;
  correctionResult: VoidSaleData;
  queryClient: QueryClient;
  isCurrent?: () => boolean;
}) {
  if (
    !isCurrent() ||
    scope.role !== 'OWNER' ||
    !sameSaleId(scope.businessId, sale.business_id) ||
    !sameSaleId(sale.id, correctionResult.sale.id) ||
    !sameSaleId(scope.businessId, correctionResult.sale.business_id) ||
    !sameSaleId(correctionResult.correction.sale_id, sale.id) ||
    !sameSaleId(correctionResult.correction.business_id, scope.businessId)
  )
    return;
  const ids = new Set([
    ...correctionResult.items.flatMap((item) =>
      item.product_id === null ? [] : [item.product_id],
    ),
    ...correctionResult.stockMovements.map((m) => m.product_id),
  ]);
  const policies: Policy[] = [
    {
      queryKey: salesKeys.byBusiness(scope.businessId),
      matches: (key) =>
        matchesScope(scope, key[3], true) &&
        (key[2] === 'history' ||
          ((key[2] === 'detail' || key[2] === 'correction') && key[4] === sale.id)),
    },
    ...productPolicies(scope, ids),
    {
      queryKey: analyticsKeys.byBusiness(scope.businessId),
      matches: (key) =>
        matchesScope(scope, key[3]) &&
        ['summary', 'revenue', 'services', 'products'].includes(String(key[2])),
    },
  ];
  if (sale.client_id !== null)
    policies.push({
      queryKey: clientsKeys.stats(scope.businessId, sale.client_id, scope.userId, 'OWNER'),
      matches: () => true,
    });
  await invalidatePolicies(queryClient, policies, isCurrent);
}
