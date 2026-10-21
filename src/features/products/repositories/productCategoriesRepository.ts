import { supabase } from '@/lib/supabase/client';

import type {
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
} from '../schemas/productCategory.schema';
import type { ProductCategoryListParams } from '../types/productCategory.types';

export type ProductCategoryRow = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const columns = 'id, business_id, name, is_active, created_at, updated_at';

export const productCategoriesRepository = {
  getByIds(businessId: string, categoryIds: readonly string[]) {
    const ids = [...new Set(categoryIds)];
    if (!ids.length)
      return Promise.resolve({ data: [] as ProductCategoryRow[], error: null, status: 200 });
    return supabase
      .from('product_categories')
      .select(columns)
      .eq('business_id', businessId)
      .in('id', ids)
      .overrideTypes<ProductCategoryRow[], { merge: false }>();
  },
  getById(businessId: string, productCategoryId: string) {
    return supabase
      .from('product_categories')
      .select(columns)
      .eq('business_id', businessId)
      .eq('id', productCategoryId)
      .maybeSingle()
      .overrideTypes<ProductCategoryRow, { merge: false }>();
  },

  create(businessId: string, input: CreateProductCategoryInput) {
    return supabase
      .from('product_categories')
      .insert({
        business_id: businessId,
        name: input.name,
      })
      .select(columns)
      .single()
      .overrideTypes<ProductCategoryRow, { merge: false }>();
  },

  update(businessId: string, productCategoryId: string, input: UpdateProductCategoryInput) {
    const payload: UpdateProductCategoryInput = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.is_active !== undefined) payload.is_active = input.is_active;

    return supabase
      .from('product_categories')
      .update(payload)
      .eq('business_id', businessId)
      .eq('id', productCategoryId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ProductCategoryRow, { merge: false }>();
  },

  listByBusiness(businessId: string, params: Required<ProductCategoryListParams>) {
    const from = (params.page - 1) * params.pageSize;
    let query = supabase.from('product_categories').select(columns).eq('business_id', businessId);
    if (params.status !== 'all') query = query.eq('is_active', params.status === 'active');
    return query
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + params.pageSize)
      .overrideTypes<ProductCategoryRow[], { merge: false }>();
  },
};
