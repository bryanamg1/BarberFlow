CREATE TABLE public.services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  price numeric(12,2) NOT NULL,
  duration_minutes integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_pkey PRIMARY KEY (id),
  CONSTRAINT services_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT services_name_check CHECK (length(trim(name)) > 0),
  -- PostgreSQL sorts numeric NaN above finite values; it is not a monetary price.
  CONSTRAINT services_price_check CHECK (price >= 0 AND price <> 'NaN'::numeric),
  CONSTRAINT services_duration_minutes_check CHECK (duration_minutes > 0)
);

-- The business prefix also supports FK lookups without a redundant index.
CREATE INDEX services_business_id_is_active_idx ON public.services (business_id, is_active);

CREATE OR REPLACE TRIGGER services_set_updated_at
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Client access stays closed until the Security policies are implemented.
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
