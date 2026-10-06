CREATE TABLE public.sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  client_id uuid,
  appointment_id uuid,
  operation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  subtotal numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  sold_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT sales_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES public.clients (id) ON DELETE RESTRICT,
  CONSTRAINT sales_appointment_id_fkey FOREIGN KEY (appointment_id)
    REFERENCES public.appointments (id) ON DELETE RESTRICT,
  CONSTRAINT sales_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT sales_business_id_operation_id_key UNIQUE (business_id, operation_id),
  CONSTRAINT sales_status_check CHECK (status IN ('DRAFT', 'COMPLETED', 'VOIDED')),
  -- Numeric NaN compares above finite values; exclude it for every monetary field.
  CONSTRAINT sales_subtotal_check CHECK (subtotal >= 0 AND subtotal <> 'NaN'::numeric),
  CONSTRAINT sales_discount_check CHECK (discount >= 0 AND discount <> 'NaN'::numeric),
  CONSTRAINT sales_total_check CHECK (total >= 0 AND total <> 'NaN'::numeric),
  CONSTRAINT sales_discount_subtotal_check CHECK (discount <= subtotal),
  CONSTRAINT sales_total_calculation_check CHECK (total = subtotal - discount)
);

-- Sale time drives business finance/history and client history; no duplicate operation index.
CREATE INDEX sales_business_id_sold_at_idx ON public.sales (business_id, sold_at);
CREATE INDEX sales_client_id_sold_at_idx ON public.sales (client_id, sold_at);
-- Appointment lookup and FK checks; no appointment uniqueness is assumed.
CREATE INDEX sales_appointment_id_idx ON public.sales (appointment_id);

CREATE OR REPLACE TRIGGER sales_set_updated_at
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cross-business checks, immutable history and checkout/void workflows belong to Security/RPC.
-- Client access stays closed until those policies are implemented.
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
