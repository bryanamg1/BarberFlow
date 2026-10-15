export type PurchaseStatus = 'DRAFT' | 'COMPLETED' | 'VOIDED';

// Persisted SDK projections. Completion inputs are a separate, allowlisted shape.
export type PurchaseRow = {
  id: string;
  business_id: string;
  operation_id: string;
  supplier: string;
  status: PurchaseStatus;
  total: number;
  purchased_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PurchaseItemRow = {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_cost_snapshot: number;
  line_total: number;
  created_at: string;
};
