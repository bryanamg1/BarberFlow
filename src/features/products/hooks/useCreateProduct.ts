import type { CreateProductInput } from '../schemas/product.schema';
import type { ProductMutationResult } from '../types/productHooks.types';
import { useProductMutation } from './useProductMutation';

export function useCreateProduct(): ProductMutationResult<CreateProductInput> {
  return useProductMutation('create', null);
}
