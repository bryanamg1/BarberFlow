CREATE TABLE public.business_settings (
  -- The business identity is also the settings PK: one unique row per business.
  business_id uuid NOT NULL,
  appointment_interval_minutes integer NOT NULL DEFAULT 30,
  default_service_buffer_minutes integer NOT NULL DEFAULT 0,
  allow_overlapping_appointments boolean NOT NULL DEFAULT false,
  low_stock_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_settings_pkey PRIMARY KEY (business_id),
  CONSTRAINT business_settings_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT business_settings_appointment_interval_check CHECK (appointment_interval_minutes > 0),
  CONSTRAINT business_settings_service_buffer_check CHECK (default_service_buffer_minutes >= 0)
);

CREATE OR REPLACE TRIGGER business_settings_set_updated_at
BEFORE UPDATE ON public.business_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
