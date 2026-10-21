import type { ProductListParams } from '../types/product.types';
import type { ProductListInput } from '../types/productHooks.types';
import { usableProductId } from './productErrors';

export function normalizeProductListParams(input: ProductListInput = {}): ProductListParams | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const status = input.status ?? 'active';
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !['active', 'inactive', 'all'].includes(status) ||
    (input.categoryId !== undefined && !usableProductId(input.categoryId))
  )
    return null;
  const from = (page - 1) * pageSize;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(from + pageSize)) return null;
  return {
    page,
    pageSize,
    status,
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  };
}
