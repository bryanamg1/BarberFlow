CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text,
  phone text,
  email text,
  instagram text,
  birth_date date,
  notes text,
  preferences text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_pkey PRIMARY KEY (id),
  CONSTRAINT clients_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT clients_first_name_check CHECK (length(trim(first_name)) > 0)
);

-- Both lookups are scoped by business; their prefixes also cover the FK.
CREATE INDEX clients_business_id_is_active_idx ON public.clients (business_id, is_active);
CREATE INDEX clients_business_id_phone_idx ON public.clients (business_id, phone);

CREATE OR REPLACE TRIGGER clients_set_updated_at
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- No client access until the Security policies are implemented.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
