import { supabase } from '@/lib/supabase/client';

import type { CreateProductInput, UpdateProductInput } from '../schemas/product.schema';
import type { ProductListParams, ProductRow } from '../types/product.types';

const columns =
  'id, business_id, category_id, name, description, sku, sale_price, default_purchase_cost, minimum_stock, is_active, created_at, updated_at';

export const productsRepository = {
  getById(businessId: string, productId: string) {
    return supabase
      .from('products')
      .select(columns)
      .eq('business_id', businessId)
      .eq('id', productId)
      .maybeSingle()
      .overrideTypes<ProductRow, { merge: false }>();
  },

  create(businessId: string, input: CreateProductInput) {
    return supabase
      .from('products')
      .insert({
        business_id: businessId,
        name: input.name,
        category_id: input.category_id,
        description: input.description,
        sku: input.sku,
        sale_price: input.sale_price,
        default_purchase_cost: input.default_purchase_cost,
        minimum_stock: input.minimum_stock,
      })
      .select(columns)
      .single()
      .overrideTypes<ProductRow, { merge: false }>();
  },

  update(businessId: string, productId: string, input: UpdateProductInput) {
    const payload: UpdateProductInput = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.category_id !== undefined) payload.category_id = input.category_id;
    if (input.description !== undefined) payload.description = input.description;
    if (input.sku !== undefined) payload.sku = input.sku;
    if (input.sale_price !== undefined) payload.sale_price = input.sale_price;
    if (input.default_purchase_cost !== undefined)
      payload.default_purchase_cost = input.default_purchase_cost;
    if (input.minimum_stock !== undefined) payload.minimum_stock = input.minimum_stock;
    if (input.is_active !== undefined) payload.is_active = input.is_active;

    return supabase
      .from('products')
      .update(payload)
      .eq('business_id', businessId)
      .eq('id', productId)
      .select(columns)
      .maybeSingle()
      .overrideTypes<ProductRow, { merge: false }>();
  },

  listByBusiness(businessId: string, params: ProductListParams) {
    const from = (params.page - 1) * params.pageSize;
    let query = supabase.from('products').select(columns).eq('business_id', businessId);
    if (params.status !== 'all') query = query.eq('is_active', params.status === 'active');
    if (params.categoryId !== undefined) query = query.eq('category_id', params.categoryId);

    return query
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + params.pageSize)
      .overrideTypes<ProductRow[], { merge: false }>();
  },
};
