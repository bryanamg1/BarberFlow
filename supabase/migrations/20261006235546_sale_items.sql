CREATE TABLE public.sale_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  item_type text NOT NULL,
  service_id uuid,
  product_id uuid,
  item_name_snapshot text NOT NULL,
  unit_price_snapshot numeric(12,2) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  line_total numeric(12,2) NOT NULL,
  unit_cost_snapshot numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_items_pkey PRIMARY KEY (id),
  CONSTRAINT sale_items_sale_id_fkey FOREIGN KEY (sale_id)
    REFERENCES public.sales (id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_service_id_fkey FOREIGN KEY (service_id)
    REFERENCES public.services (id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES public.products (id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_item_type_check CHECK (item_type IN ('SERVICE', 'PRODUCT')),
  CONSTRAINT sale_items_item_reference_check CHECK (
    (item_type = 'SERVICE' AND service_id IS NOT NULL AND product_id IS NULL)
    OR (item_type = 'PRODUCT' AND product_id IS NOT NULL AND service_id IS NULL)
  ),
  CONSTRAINT sale_items_item_name_snapshot_check CHECK (length(trim(item_name_snapshot)) > 0),
  -- Numeric NaN compares above finite values; exclude it explicitly from snapshots.
  CONSTRAINT sale_items_unit_price_snapshot_check CHECK (
    unit_price_snapshot >= 0 AND unit_price_snapshot <> 'NaN'::numeric
  ),
  CONSTRAINT sale_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT sale_items_line_total_check CHECK (
    line_total >= 0 AND line_total <> 'NaN'::numeric
    AND line_total = unit_price_snapshot * quantity
  ),
  CONSTRAINT sale_items_unit_cost_snapshot_check CHECK (
    (item_type = 'SERVICE' AND unit_cost_snapshot IS NULL)
    OR (item_type = 'PRODUCT' AND unit_cost_snapshot IS NOT NULL
        AND unit_cost_snapshot >= 0 AND unit_cost_snapshot <> 'NaN'::numeric)
  )
);

-- Load sale lines and support restrictive catalog FK lookups; duplicates remain valid.
CREATE INDEX sale_items_sale_id_idx ON public.sale_items (sale_id);
CREATE INDEX sale_items_service_id_idx ON public.sale_items (service_id);
CREATE INDEX sale_items_product_id_idx ON public.sale_items (product_id);

-- Explicit historical snapshots only: no catalog-copy, stock, totals or updated_at triggers.
-- Ownership is derived through sales; cross-business checks belong to checkout/Security.
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
