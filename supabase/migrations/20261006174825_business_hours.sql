CREATE TABLE public.business_hours (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  open_time time NOT NULL,
  close_time time NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_hours_pkey PRIMARY KEY (id),
  CONSTRAINT business_hours_business_id_fkey FOREIGN KEY (business_id)
    REFERENCES public.businesses (id) ON DELETE RESTRICT,
  CONSTRAINT business_hours_business_day_key UNIQUE (business_id, day_of_week),
  CONSTRAINT business_hours_day_of_week_check CHECK (day_of_week BETWEEN 0 AND 6),
  -- Closed days keep explicit times; V1 has no overnight opening intervals.
  CONSTRAINT business_hours_open_interval_check CHECK (is_closed OR close_time > open_time)
);

CREATE OR REPLACE TRIGGER business_hours_set_updated_at
BEFORE UPDATE ON public.business_hours
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;
