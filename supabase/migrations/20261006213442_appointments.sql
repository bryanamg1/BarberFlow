CREATE TABLE public.appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  client_id uuid NOT NULL,
  barber_member_id uuid NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_pkey PRIMARY KEY (id),
  CONSTRAINT appointments_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES public.clients (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_barber_member_id_fkey FOREIGN KEY (barber_member_id)
    REFERENCES public.business_members (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT appointments_time_check CHECK (end_at > start_at),
  CONSTRAINT appointments_status_check CHECK (
    status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')
  )
);

-- Business agenda, barber agenda and client history; no standalone business index.
CREATE INDEX appointments_business_id_start_at_idx ON public.appointments (business_id, start_at);
CREATE INDEX appointments_business_id_barber_member_id_start_at_idx
  ON public.appointments (business_id, barber_member_id, start_at);
CREATE INDEX appointments_business_id_client_id_start_at_idx
  ON public.appointments (business_id, client_id, start_at);

CREATE OR REPLACE TRIGGER appointments_set_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cross-business validation, availability and status workflows belong to later tickets.
-- Client access stays closed until the Security policies are implemented.
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
