// Persisted catalog only. Stock is derived from movements in its owning domain.
export type ProductRow = {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  sale_price: number;
  default_purchase_cost: number;
  minimum_stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Resolved pagination/status come from the future service, as in Services/Clients.
export type ProductListParams = {
  page: number;
  pageSize: number;
  status: 'active' | 'inactive' | 'all';
  categoryId?: string;
};
