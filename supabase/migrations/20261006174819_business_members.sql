CREATE TABLE public.business_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_members_pkey PRIMARY KEY (id),
  CONSTRAINT business_members_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT business_members_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT business_members_business_user_key UNIQUE (business_id, user_id),
  -- Two foundation roles need only a versionable CHECK, not a separate enum type.
  CONSTRAINT business_members_role_check CHECK (role IN ('OWNER', 'BARBER'))
);

-- The unique index above also covers lookups by business_id.
CREATE INDEX business_members_user_id_idx ON public.business_members (user_id);

CREATE OR REPLACE TRIGGER business_members_set_updated_at
BEFORE UPDATE ON public.business_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
