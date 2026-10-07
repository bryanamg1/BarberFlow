CREATE TABLE public.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  payment_method text NOT NULL,
  amount numeric(12,2) NOT NULL,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT payments_sale_id_fkey FOREIGN KEY (sale_id)
    REFERENCES public.sales (id) ON DELETE RESTRICT,
  CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT payments_payment_method_check CHECK (
    payment_method IN ('CASH', 'TRANSFER', 'DEBIT', 'CREDIT', 'OTHER')
  ),
  -- Numeric NaN compares above finite values; exclude it explicitly from payments.
  CONSTRAINT payments_amount_check CHECK (amount > 0 AND amount <> 'NaN'::numeric)
);

-- Load all payments for a sale and support its restrictive FK; split payments remain valid.
CREATE INDEX payments_sale_id_idx ON public.payments (sale_id);

-- No aggregate payment validation, sale completion, cross-business or commerce triggers.
-- Client access stays closed until the authorized Security/checkout workflows exist.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
