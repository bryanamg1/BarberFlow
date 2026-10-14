export type StockMovementType = 'PURCHASE' | 'SALE' | 'LOSS' | 'ADJUSTMENT' | 'RETURN';

export type StockMovementRow = {
  id: string;
  business_id: string;
  product_id: string;
  type: StockMovementType;
  quantity_delta: number;
  unit_cost: number | null;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  occurred_at: string;
  created_by: string;
  created_at: string;
};

// The server aggregates bigint stock. Keep its integer string intact across transport.
export type ProductStockRow = {
  product_id: string;
  current_stock: string;
};

export type LowStockProductRow = ProductStockRow & {
  name: string;
  minimum_stock: number;
};

export type InventoryPageParams = {
  page: number;
  pageSize: number;
};

export type StockMovementListParams = InventoryPageParams & {
  type?: StockMovementType;
  from?: string;
  to?: string;
};
