import { productsRepository } from '../repositories/productsRepository';
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '../schemas/product.schema';
import type { ProductRow } from '../types/product.types';
import type {
  ProductErrorCode,
  ProductListInput,
  ProductListPage,
  ProductResult,
} from '../types/productHooks.types';
import { productError, usableProductId } from '../utils/productErrors';
import { normalizeProductListParams } from '../utils/productListParams';

const failure = (code: ProductErrorCode) => ({ data: null, error: productError(code) });
async function run<T>(
  operation: () => PromiseLike<{ data: T | null; error: { code: string } | null; status: number }>,
  nullCode: ProductErrorCode,
): Promise<ProductResult<T>> {
  try {
    const result = await operation();
    if (result.error !== null) {
      if (result.status === 0) return failure('NETWORK_ERROR');
      if (result.status === 401 || result.status === 403 || result.error.code === '42501')
        return failure('PRODUCT_ACCESS_DENIED');
      return failure('UNKNOWN_ERROR');
    }
    if (result.data == null) return failure(nullCode);
    return { data: result.data, error: null };
  } catch {
    return failure('UNKNOWN_ERROR');
  }
}
export const productsService = {
  async listByBusiness(
    businessId: string,
    input?: ProductListInput,
  ): Promise<ProductResult<ProductListPage>> {
    if (!usableProductId(businessId)) return failure('PRODUCT_ACCESS_DENIED');
    const params = normalizeProductListParams(input);
    if (!params) return failure('INVALID_INPUT');
    const result = await run(
      () => productsRepository.listByBusiness(businessId, params),
      'UNKNOWN_ERROR',
    );
    if (result.error) return result;
    return {
      data: {
        items: result.data.slice(0, params.pageSize),
        page: params.page,
        pageSize: params.pageSize,
        hasNextPage: result.data.length > params.pageSize,
      },
      error: null,
    };
  },
  getById(businessId: string, productId: string): Promise<ProductResult<ProductRow>> {
    if (!usableProductId(businessId) || !usableProductId(productId))
      return Promise.resolve(failure('PRODUCT_NOT_FOUND'));
    return run(() => productsRepository.getById(businessId, productId), 'PRODUCT_NOT_FOUND');
  },
  create(businessId: string, input: CreateProductInput): Promise<ProductResult<ProductRow>> {
    if (!usableProductId(businessId)) return Promise.resolve(failure('PRODUCT_ACCESS_DENIED'));
    const parsed = createProductSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(failure('INVALID_INPUT'));
    return run(() => productsRepository.create(businessId, parsed.data), 'UNKNOWN_ERROR');
  },
  update(
    businessId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductResult<ProductRow>> {
    if (!usableProductId(businessId) || !usableProductId(productId))
      return Promise.resolve(failure('PRODUCT_NOT_FOUND'));
    const parsed = updateProductSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(failure('INVALID_INPUT'));
    return run(
      () => productsRepository.update(businessId, productId, parsed.data),
      'PRODUCT_NOT_FOUND',
    );
  },
};
