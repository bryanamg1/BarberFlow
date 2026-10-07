CREATE TABLE public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  category_id uuid NOT NULL,
  source_type text NOT NULL,
  purchase_id uuid,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL,
  expense_date date NOT NULL,
  receipt_path text,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES public.expense_categories (id) ON DELETE RESTRICT,
  CONSTRAINT expenses_purchase_id_fkey FOREIGN KEY (purchase_id)
    REFERENCES public.purchases (id) ON DELETE RESTRICT,
  CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  -- Multiple NULL purchase IDs remain valid for independent manual expenses.
  CONSTRAINT expenses_purchase_id_key UNIQUE (purchase_id),
  CONSTRAINT expenses_source_type_check CHECK (source_type IN ('MANUAL', 'PURCHASE')),
  CONSTRAINT expenses_purchase_source_check CHECK (
    (source_type = 'PURCHASE' AND purchase_id IS NOT NULL)
    OR (source_type = 'MANUAL' AND purchase_id IS NULL)
  ),
  -- Zero is explicitly permitted; numeric NaN must be rejected separately from the range.
  CONSTRAINT expenses_amount_check CHECK (amount >= 0 AND amount <> 'NaN'::numeric),
  CONSTRAINT expenses_payment_method_check CHECK (
    payment_method IN ('CASH', 'TRANSFER', 'DEBIT', 'CREDIT', 'OTHER')
  )
);

-- Expense history per business and civil date; purchase uniqueness covers its own FK.
CREATE INDEX expenses_business_id_expense_date_idx ON public.expenses (business_id, expense_date);

CREATE OR REPLACE TRIGGER expenses_set_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No purchase completion, amount synchronization, stock, categories or analytics effects.
-- Authorization and purchase correction workflows belong to Security/RPC.
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
