import {
  productCategoriesRepository,
  type ProductCategoryRow,
} from '../repositories/productCategoriesRepository';
import {
  createProductCategorySchema,
  updateProductCategorySchema,
  type CreateProductCategoryInput,
  type UpdateProductCategoryInput,
} from '../schemas/productCategory.schema';
import type {
  ProductCategoryError,
  ProductCategoryErrorCode,
  ProductCategoryResult,
  ProductCategoryListParams,
  ProductCategoryListResult,
} from '../types/productCategory.types';
import { normalizeProductCategoryListParams } from '../utils/productCategoryListParams';

const usableId = (value: string) => typeof value === 'string' && value.trim().length > 0;

const messages: Record<ProductCategoryErrorCode, string> = {
  PRODUCT_CATEGORY_NOT_FOUND: 'No se encontró la categoría o no está disponible.',
  PRODUCT_CATEGORY_ACCESS_DENIED: 'No se pudo acceder a la categoría.',
  NETWORK_ERROR: 'No se pudo conectar con la categoría. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación dla categoría. Inténtalo nuevamente.',
};

function failure(code: ProductCategoryErrorCode): { data: null; error: ProductCategoryError } {
  return { data: null, error: { code, message: messages[code] } };
}

async function runOperation<T>(
  operation: () => PromiseLike<{ data: T | null; error: { code: string } | null; status: number }>,
  nullCode: 'PRODUCT_CATEGORY_NOT_FOUND' | 'UNKNOWN_ERROR',
): Promise<{ data: T; error: null } | { data: null; error: ProductCategoryError }> {
  try {
    const result = await operation();
    if (result.error !== null) {
      if (result.status === 0) return failure('NETWORK_ERROR');
      if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
        return failure('PRODUCT_CATEGORY_ACCESS_DENIED');
      }
      return failure('UNKNOWN_ERROR');
    }
    if (result.data === null) return failure(nullCode);
    return { data: result.data, error: null };
  } catch {
    return failure('UNKNOWN_ERROR');
  }
}

export const productCategoriesService = {
  getByIds(
    businessId: string,
    categoryIds: readonly string[],
  ): Promise<
    { data: ProductCategoryRow[]; error: null } | { data: null; error: ProductCategoryError }
  > {
    if (!usableId(businessId)) return Promise.resolve(failure('PRODUCT_CATEGORY_ACCESS_DENIED'));
    if (!Array.isArray(categoryIds) || !categoryIds.every(usableId))
      return Promise.resolve(failure('UNKNOWN_ERROR'));
    const ids = [...new Set(categoryIds)];
    if (!ids.length) return Promise.resolve({ data: [], error: null });
    return runOperation(
      () => productCategoriesRepository.getByIds(businessId, ids),
      'UNKNOWN_ERROR',
    );
  },
  getById(businessId: string, productCategoryId: string): Promise<ProductCategoryResult> {
    if (!usableId(businessId) || !usableId(productCategoryId))
      return Promise.resolve(failure('PRODUCT_CATEGORY_NOT_FOUND'));
    return runOperation(
      () => productCategoriesRepository.getById(businessId, productCategoryId),
      'PRODUCT_CATEGORY_NOT_FOUND',
    );
  },

  create(businessId: string, input: CreateProductCategoryInput): Promise<ProductCategoryResult> {
    if (!usableId(businessId)) return Promise.resolve(failure('PRODUCT_CATEGORY_ACCESS_DENIED'));
    const validated = createProductCategorySchema.safeParse(input);
    if (!validated.success) return Promise.resolve(failure('UNKNOWN_ERROR'));
    return runOperation(
      () => productCategoriesRepository.create(businessId, validated.data),
      'UNKNOWN_ERROR',
    );
  },

  update(
    businessId: string,
    productCategoryId: string,
    input: UpdateProductCategoryInput,
  ): Promise<ProductCategoryResult> {
    if (!usableId(businessId) || !usableId(productCategoryId))
      return Promise.resolve(failure('PRODUCT_CATEGORY_NOT_FOUND'));
    const validated = updateProductCategorySchema.safeParse(input);
    if (!validated.success) return Promise.resolve(failure('UNKNOWN_ERROR'));
    return runOperation(
      () => productCategoriesRepository.update(businessId, productCategoryId, validated.data),
      'PRODUCT_CATEGORY_NOT_FOUND',
    );
  },

  async listByBusiness(
    businessId: string,
    params?: ProductCategoryListParams,
  ): Promise<ProductCategoryListResult> {
    if (!usableId(businessId)) return failure('PRODUCT_CATEGORY_ACCESS_DENIED');
    const normalized = normalizeProductCategoryListParams(params);
    if (normalized === null) return failure('UNKNOWN_ERROR');
    const result = await runOperation(
      () => productCategoriesRepository.listByBusiness(businessId, normalized),
      'UNKNOWN_ERROR',
    );
    if (result.error !== null) return result;
    return {
      data: {
        items: result.data.slice(0, normalized.pageSize),
        page: normalized.page,
        pageSize: normalized.pageSize,
        hasNextPage: result.data.length > normalized.pageSize,
      },
      error: null,
    };
  },
};
