CREATE TABLE public.purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  supplier text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  total numeric(12,2) NOT NULL,
  purchased_at timestamptz,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchases_pkey PRIMARY KEY (id),
  CONSTRAINT purchases_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT purchases_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT purchases_business_id_operation_id_key UNIQUE (business_id, operation_id),
  CONSTRAINT purchases_status_check CHECK (status IN ('DRAFT', 'COMPLETED', 'VOIDED')),
  CONSTRAINT purchases_supplier_check CHECK (length(trim(supplier)) > 0),
  CONSTRAINT purchases_total_check CHECK (total >= 0),
  -- Numeric NaN compares above finite values; exclude it explicitly.
  CONSTRAINT purchases_total_not_nan_check CHECK (total <> 'NaN'::numeric)
);

-- Purchase history per business; operation uniqueness already has its own index.
CREATE INDEX purchases_business_id_purchased_at_idx ON public.purchases (business_id, purchased_at);

CREATE OR REPLACE TRIGGER purchases_set_updated_at
BEFORE UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No lines, inventory, expense, product-cost, totals or state-transition side effects.
-- Immutable completed history and authorized completion/void workflows belong to Security/RPC.
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
