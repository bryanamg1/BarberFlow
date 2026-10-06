CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  category_id uuid,
  name text NOT NULL,
  description text,
  sku text,
  sale_price numeric(12,2) NOT NULL,
  default_purchase_cost numeric(12,2) NOT NULL,
  minimum_stock integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id)
    REFERENCES public.product_categories (id) ON DELETE RESTRICT,
  CONSTRAINT products_name_check CHECK (length(trim(name)) > 0),
  -- PostgreSQL numeric NaN compares above finite values; exclude it explicitly.
  CONSTRAINT products_sale_price_check CHECK (sale_price >= 0 AND sale_price <> 'NaN'::numeric),
  CONSTRAINT products_default_purchase_cost_check
    CHECK (default_purchase_cost >= 0 AND default_purchase_cost <> 'NaN'::numeric),
  CONSTRAINT products_minimum_stock_check CHECK (minimum_stock >= 0)
);

-- Active catalog per business; the prefix also supports business FK lookups.
CREATE INDEX products_business_id_is_active_idx ON public.products (business_id, is_active);
-- Category filtering and category FK lookups are not covered by the business index.
CREATE INDEX products_category_id_idx ON public.products (category_id);

CREATE OR REPLACE TRIGGER products_set_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Client access stays closed until the Security policies are implemented.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
