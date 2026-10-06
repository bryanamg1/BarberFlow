CREATE TABLE public.businesses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  address text,
  logo_path text,
  currency_code text NOT NULL DEFAULT 'ARS',
  timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT businesses_pkey PRIMARY KEY (id)
);

CREATE OR REPLACE TRIGGER businesses_set_updated_at
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
