CREATE TABLE public.purchase_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  quantity integer NOT NULL,
  unit_cost_snapshot numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_items_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_items_purchase_id_fkey FOREIGN KEY (purchase_id)
    REFERENCES public.purchases (id) ON DELETE RESTRICT,
  CONSTRAINT purchase_items_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES public.products (id) ON DELETE RESTRICT,
  CONSTRAINT purchase_items_product_name_snapshot_check CHECK (length(trim(product_name_snapshot)) > 0),
  CONSTRAINT purchase_items_quantity_check CHECK (quantity > 0),
  -- Numeric NaN compares above finite values; exclude it explicitly from costs and totals.
  CONSTRAINT purchase_items_unit_cost_snapshot_check CHECK (
    unit_cost_snapshot >= 0 AND unit_cost_snapshot <> 'NaN'::numeric
  ),
  CONSTRAINT purchase_items_line_total_check CHECK (
    line_total >= 0 AND line_total <> 'NaN'::numeric
    AND line_total = unit_cost_snapshot * quantity
  )
);

-- Load purchase lines and product purchase history; duplicate product lines are allowed.
CREATE INDEX purchase_items_purchase_id_idx ON public.purchase_items (purchase_id);
CREATE INDEX purchase_items_product_id_idx ON public.purchase_items (product_id);

-- Explicit historical snapshots only: no stock, product cost, totals or timestamp triggers.
-- Ownership derives through purchases; authorized completion belongs to future RPC/Security.
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
