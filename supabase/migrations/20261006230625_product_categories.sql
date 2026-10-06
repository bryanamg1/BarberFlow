CREATE TABLE public.product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_categories_pkey PRIMARY KEY (id),
  CONSTRAINT product_categories_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT product_categories_name_check CHECK (length(trim(name)) > 0)
);

-- Active categories per business; the prefix also covers business FK lookups.
CREATE INDEX product_categories_business_id_is_active_idx
  ON public.product_categories (business_id, is_active);

CREATE OR REPLACE TRIGGER product_categories_set_updated_at
BEFORE UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No client access until the Security policies are implemented.
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
