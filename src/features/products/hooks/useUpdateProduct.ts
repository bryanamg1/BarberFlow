import type { UpdateProductInput } from '../schemas/product.schema';
import type { ProductMutationResult } from '../types/productHooks.types';
import { useProductMutation } from './useProductMutation';

export function useUpdateProduct(
  productId: string | null,
): ProductMutationResult<UpdateProductInput> {
  return useProductMutation('update', productId);
}
