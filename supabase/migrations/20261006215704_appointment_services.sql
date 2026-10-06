CREATE TABLE public.appointment_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL,
  service_id uuid,
  service_name_snapshot text NOT NULL,
  unit_price_snapshot numeric(12,2) NOT NULL,
  duration_minutes_snapshot integer NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  line_total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_services_pkey PRIMARY KEY (id),
  CONSTRAINT appointment_services_appointment_id_fkey FOREIGN KEY (appointment_id)
    REFERENCES public.appointments (id) ON DELETE RESTRICT,
  CONSTRAINT appointment_services_service_id_fkey FOREIGN KEY (service_id)
    REFERENCES public.services (id) ON DELETE RESTRICT,
  CONSTRAINT appointment_services_service_name_snapshot_check CHECK (length(trim(service_name_snapshot)) > 0),
  CONSTRAINT appointment_services_unit_price_snapshot_check CHECK (
    unit_price_snapshot >= 0 AND unit_price_snapshot <> 'NaN'::numeric
  ),
  CONSTRAINT appointment_services_duration_minutes_snapshot_check CHECK (duration_minutes_snapshot > 0),
  CONSTRAINT appointment_services_quantity_check CHECK (quantity > 0),
  CONSTRAINT appointment_services_line_total_check CHECK (
    line_total >= 0 AND line_total <> 'NaN'::numeric
    AND line_total = unit_price_snapshot * quantity
  )
);

-- Load appointment lines and support service reference lookups without uniqueness.
CREATE INDEX appointment_services_appointment_id_idx ON public.appointment_services (appointment_id);
CREATE INDEX appointment_services_service_id_idx ON public.appointment_services (service_id);

-- Snapshots and line_total are supplied by the future transactional workflow.
-- No catalog-copy triggers, updated_at, or cross-business triggers in this ticket.
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;
