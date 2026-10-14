import type { ProductCategoryListParams } from '../types/productCategory.types';

export function normalizeProductCategoryListParams(
  params: ProductCategoryListParams = {},
): Required<ProductCategoryListParams> | null {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const status = params.status ?? 'active';
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (status !== 'active' && status !== 'inactive' && status !== 'all')
  )
    return null;
  const from = (page - 1) * pageSize;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(from + pageSize)) return null;
  return { page, pageSize, status };
}
