BEGIN;

-- Pure civil-time geometry. Invoker only; no tenant data, writes or privileged reads.
CREATE FUNCTION private.appointment_slot_candidates(
  p_date date, p_timezone text, p_open time, p_close time,
  p_interval_minutes integer, p_duration_minutes integer, p_buffer_minutes integer
)
RETURNS TABLE (start_at timestamptz, end_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  local_open timestamp;
  local_close timestamp;
  scan_start timestamptz;
  scan_end timestamptz;
BEGIN
  IF p_date IS NULL OR NOT pg_catalog.isfinite(p_date)
     OR p_date < '0001-01-01'::date OR p_date > '9999-12-31'::date
     OR p_open IS NULL OR p_close IS NULL OR p_close <= p_open
     OR p_interval_minutes IS NULL OR p_interval_minutes <= 0
     OR p_duration_minutes IS NULL OR p_duration_minutes <= 0
     OR p_buffer_minutes IS NULL OR p_buffer_minutes < 0
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE lower(name)=lower(p_timezone)) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Revisa la configuración del horario solicitado.';
  END IF;
  local_open := p_date + p_open;
  local_close := p_date + p_close;
  -- TZif transitions/offsets have integral-second precision. The bounded UTC
  -- envelope covers the TZif recommended offset range (-25h, +26h); it is not
  -- a booking horizon. Inspect every second so short/historical transitions
  -- and second-based offsets cannot disappear in an hourly/minute sample.
  scan_start := (p_date::timestamp AT TIME ZONE 'UTC') - interval '26 hours';
  scan_end := ((p_date + 1)::timestamp AT TIME ZONE 'UTC') + interval '26 hours';

  RETURN QUERY
  WITH transitions AS MATERIALIZED (
    SELECT probe, (probe AT TIME ZONE p_timezone) - (probe AT TIME ZONE 'UTC') AS utc_offset
    FROM pg_catalog.generate_series(scan_start, scan_end, interval '1 second') AS samples(probe)
    WHERE probe=scan_start OR
      (probe AT TIME ZONE p_timezone) - ((probe-interval '1 second') AT TIME ZONE p_timezone)
        <> interval '1 second'
  ), segments AS (
    SELECT probe, lead(probe,1,scan_end) OVER (ORDER BY probe) AS until, utc_offset
    FROM transitions
  ), windows AS (
    SELECT greatest(probe,(local_open-utc_offset) AT TIME ZONE 'UTC') AS lo,
      least(until,(local_close-utc_offset) AT TIME ZONE 'UTC') AS hi
    FROM segments
  ), opening AS (
    -- Merge touching pieces, but retain closed civil-time holes in a DST fold.
    SELECT range_agg(tstzrange(lo,hi,'[)')) AS allowed FROM windows WHERE lo<hi
  ), offsets AS (
    SELECT DISTINCT utc_offset FROM transitions
  ), civil_grid AS (
    SELECT clock_time FROM pg_catalog.generate_series(local_open,local_close,
      pg_catalog.make_interval(mins=>p_interval_minutes)) AS grid(clock_time)
    WHERE clock_time<local_close
  ), candidates AS (
    SELECT (clock_time-utc_offset) AT TIME ZONE 'UTC' AS instant, clock_time
    FROM civil_grid CROSS JOIN offsets
  )
  SELECT DISTINCT candidate.instant,
    candidate.instant+pg_catalog.make_interval(mins=>p_duration_minutes)
  FROM candidates AS candidate CROSS JOIN opening
  WHERE candidate.instant AT TIME ZONE p_timezone = candidate.clock_time
    AND tstzrange(candidate.instant,
      candidate.instant+pg_catalog.make_interval(mins=>p_duration_minutes)
        +pg_catalog.make_interval(mins=>p_buffer_minutes),'[)') <@ opening.allowed
  ORDER BY 1;
END;
$$;

CREATE FUNCTION public.get_availability(
  p_business_id uuid, p_barber_member_id uuid, p_date date,
  p_duration_minutes integer, p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS TABLE (start_at timestamptz, end_at timestamptz, available boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  owner_access boolean;
  target_user uuid;
  business_timezone text;
  settings public.business_settings%ROWTYPE;
  hours public.business_hours%ROWTYPE;
BEGIN
  IF actor IS NULL OR public.has_business_role(p_business_id,ARRAY['OWNER','BARBER']) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder a esta agenda.';
  END IF;
  owner_access := public.has_business_role(p_business_id,ARRAY['OWNER']);
  SELECT member.user_id INTO target_user FROM public.business_members AS member
    WHERE member.id=p_barber_member_id AND member.business_id=p_business_id
      AND member.is_active AND member.role IN ('OWNER','BARBER');
  IF NOT FOUND OR (NOT owner_access AND target_user IS DISTINCT FROM actor) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder a esta agenda.';
  END IF;
  IF p_date IS NULL OR NOT pg_catalog.isfinite(p_date)
     OR p_date < '0001-01-01'::date OR p_date > '9999-12-31'::date
     OR p_duration_minutes IS NULL OR p_duration_minutes<=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Revisa la fecha y duración del turno.';
  END IF;
  IF p_exclude_appointment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointments AS excluded
    WHERE excluded.id=p_exclude_appointment_id AND excluded.business_id=p_business_id
  ) THEN
    -- RLS-hidden, nonexistent and foreign IDs share the same public failure.
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder a esta agenda.';
  END IF;
  SELECT business.timezone INTO business_timezone FROM public.businesses AS business WHERE business.id=p_business_id;
  SELECT config.* INTO settings FROM public.business_settings AS config WHERE config.business_id=p_business_id;
  IF NOT FOUND OR settings.appointment_interval_minutes<=0 OR settings.default_service_buffer_minutes<0
     OR business_timezone IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_timezone_names WHERE lower(name)=lower(business_timezone)
     ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='La configuración de la agenda no está disponible.';
  END IF;
  SELECT day.* INTO hours FROM public.business_hours AS day
    WHERE day.business_id=p_business_id AND day.day_of_week=extract(dow FROM p_date)::integer;
  IF NOT FOUND OR hours.is_closed THEN RETURN; END IF;

  RETURN QUERY
  SELECT slot.start_at,slot.end_at,
    CASE WHEN settings.allow_overlapping_appointments THEN true ELSE NOT EXISTS (
      SELECT 1 FROM public.appointments AS appointment
      WHERE appointment.business_id=p_business_id AND appointment.barber_member_id=p_barber_member_id
        AND appointment.status IN ('PENDING','CONFIRMED','IN_PROGRESS')
        AND appointment.id IS DISTINCT FROM p_exclude_appointment_id
        AND appointment.start_at<slot.end_at+pg_catalog.make_interval(mins=>settings.default_service_buffer_minutes)
        AND appointment.end_at+pg_catalog.make_interval(mins=>settings.default_service_buffer_minutes)>slot.start_at
    ) END
  FROM private.appointment_slot_candidates(p_date,business_timezone,hours.open_time,hours.close_time,
    settings.appointment_interval_minutes,p_duration_minutes,settings.default_service_buffer_minutes) AS slot
  ORDER BY slot.start_at;
END;
$$;

REVOKE ALL ON FUNCTION private.appointment_slot_candidates(date,text,time,time,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_availability(uuid,uuid,date,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.appointment_slot_candidates(date,text,time,time,integer,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_availability(uuid,uuid,date,integer,uuid) TO authenticated;

COMMIT;
