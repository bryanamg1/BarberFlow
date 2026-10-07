CREATE TABLE public.stock_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  type text NOT NULL,
  quantity_delta integer NOT NULL,
  unit_cost numeric(12,2),
  reference_type text,
  reference_id uuid,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_pkey PRIMARY KEY (id),
  CONSTRAINT stock_movements_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id)
    REFERENCES public.products (id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT stock_movements_type_check CHECK (type IN ('PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'RETURN')),
  CONSTRAINT stock_movements_quantity_delta_check CHECK (quantity_delta <> 0),
  -- Optional acquisition cost is finite and non-negative when supplied.
  CONSTRAINT stock_movements_unit_cost_check CHECK (unit_cost >= 0 AND unit_cost <> 'NaN'::numeric)
);

-- Documented business/product event history, also supporting business FK lookups.
CREATE INDEX stock_movements_business_id_product_id_occurred_at_idx
  ON public.stock_movements (business_id, product_id, occurred_at);
-- Product-only SUM/history and product FK lookups are not covered by the business prefix.
CREATE INDEX stock_movements_product_id_occurred_at_idx
  ON public.stock_movements (product_id, occurred_at);

-- Corrections append compensating movements; existing ledger rows cannot be rewritten.
CREATE FUNCTION public.prevent_stock_movement_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements are append-only; insert a compensating movement instead'
    USING ERRCODE = '55000';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_stock_movement_changes() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_movement_changes();

-- No stored balance, aggregate stock checks, source FK validation or business side effects.
-- Type-specific signs and transactional authorization belong to future workflows.
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
