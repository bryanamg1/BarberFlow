BEGIN;

-- Only the narrow public RPCs below can invoke this helper. It runs with their
-- checked definer identity, never with a client EXECUTE grant of its own.
CREATE FUNCTION private.lock_operational_appointment(
  p_business_id uuid, p_appointment_id uuid, p_target_member_id uuid DEFAULT NULL
) RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  appointment public.appointments%ROWTYPE;
  member_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER','BARBER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Reintenta la operación del turno.';
  END IF;
  -- Checkout already holds its operation/sale prefix before this same row.
  -- Creation holds a calendar but never locks an existing appointment row.
  SELECT a.* INTO appointment FROM public.appointments a
    WHERE a.id=p_appointment_id AND a.business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
  END IF;
  FOR member_id IN SELECT DISTINCT id FROM pg_catalog.unnest(
    ARRAY[appointment.barber_member_id,p_target_member_id]) AS members(id)
    WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'barberflow:calendar:'||p_business_id::text||':'||member_id::text,0));
  END LOOP;
  PERFORM 1 FROM public.businesses b WHERE b.id=p_business_id FOR SHARE;
  PERFORM 1 FROM public.business_members m WHERE m.business_id=p_business_id
    AND (m.user_id=auth.uid() OR m.id=appointment.barber_member_id OR m.id=p_target_member_id)
    ORDER BY m.id FOR SHARE;
  IF NOT (public.has_business_role(p_business_id,ARRAY['OWNER']) OR EXISTS (
    SELECT 1 FROM public.business_members m WHERE m.id=appointment.barber_member_id
      AND m.business_id=p_business_id AND m.user_id=auth.uid() AND m.role='BARBER' AND m.is_active
  )) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
  END IF;
  RETURN appointment;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_operational_appointment(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.change_appointment_status(
  p_business_id uuid, p_appointment_id uuid, p_status text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE appointment public.appointments%ROWTYPE;
BEGIN
  appointment := private.lock_operational_appointment(p_business_id,p_appointment_id);
  IF p_status IS NULL OR p_status NOT IN ('CONFIRMED','IN_PROGRESS','CANCELLED','NO_SHOW') THEN
    RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa el estado solicitado.';
  END IF;
  -- Authorized same-target replay never writes, including terminal no-ops.
  IF appointment.status=p_status THEN RETURN pg_catalog.to_jsonb(appointment); END IF;
  IF NOT (
    (appointment.status='PENDING' AND p_status IN ('CONFIRMED','IN_PROGRESS','CANCELLED','NO_SHOW'))
    OR (appointment.status='CONFIRMED' AND p_status IN ('IN_PROGRESS','CANCELLED','NO_SHOW'))
    OR (appointment.status='IN_PROGRESS' AND p_status IN ('CANCELLED','NO_SHOW'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='El estado del turno ya no permite esta operación.';
  END IF;
  UPDATE public.appointments SET status=p_status WHERE id=appointment.id RETURNING * INTO appointment;
  RETURN pg_catalog.to_jsonb(appointment);
END;
$$;

CREATE FUNCTION public.update_appointment_notes(
  p_business_id uuid, p_appointment_id uuid, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE appointment public.appointments%ROWTYPE;
BEGIN
  appointment := private.lock_operational_appointment(p_business_id,p_appointment_id);
  IF appointment.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='El estado del turno ya no permite esta operación.';
  END IF;
  IF appointment.notes IS DISTINCT FROM p_notes THEN
    UPDATE public.appointments SET notes=p_notes WHERE id=appointment.id RETURNING * INTO appointment;
  END IF;
  RETURN pg_catalog.to_jsonb(appointment);
END;
$$;

CREATE FUNCTION public.reschedule_appointment(
  p_business_id uuid, p_appointment_id uuid, p_barber_member_id uuid,
  p_start_at timestamptz, p_duration_override integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  appointment public.appointments%ROWTYPE;
  duration_value numeric; zone text; day_value date;
  finish timestamptz; slot_available boolean;
BEGIN
  appointment := private.lock_operational_appointment(p_business_id,p_appointment_id,p_barber_member_id);
  IF appointment.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='El estado del turno ya no permite esta operación.';
  END IF;
  IF p_barber_member_id IS NULL OR p_start_at IS NULL OR NOT pg_catalog.isfinite(p_start_at)
    OR p_start_at<'0001-01-01T00:00:00Z'::timestamptz OR p_start_at>='10000-01-01T00:00:00Z'::timestamptz
    OR p_duration_override<=0 THEN
    RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa los datos del turno.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_members m WHERE m.id=p_barber_member_id
      AND m.business_id=p_business_id AND m.is_active AND m.role IN ('OWNER','BARBER'))
    OR (NOT public.has_business_role(p_business_id,ARRAY['OWNER']) AND
      (p_barber_member_id<>appointment.barber_member_id OR p_duration_override IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
  END IF;
  -- Preserve actual persisted duration (including a previous override); catalog
  -- changes and archived services cannot rewrite the historical appointment.
  duration_value := coalesce(p_duration_override,extract(epoch FROM appointment.end_at-appointment.start_at)/60);
  IF duration_value<1 OR duration_value>2147483647 OR duration_value<>pg_catalog.trunc(duration_value) THEN
    RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa la duración del turno.';
  END IF;
  SELECT b.timezone INTO zone FROM public.businesses b WHERE b.id=p_business_id;
  PERFORM 1 FROM public.business_settings WHERE business_id=p_business_id FOR SHARE;
  IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE lower(t.name)=lower(zone)) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='La configuración horaria no está disponible.';
  END IF;
  day_value := (p_start_at AT TIME ZONE zone)::date;
  PERFORM 1 FROM public.business_hours WHERE business_id=p_business_id
    AND day_of_week=extract(dow FROM day_value)::integer FOR SHARE;
  SELECT s.end_at,s.available INTO finish,slot_available FROM public.get_availability(
    p_business_id,p_barber_member_id,day_value,duration_value::integer,p_appointment_id) s WHERE s.start_at=p_start_at;
  IF finish IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='El horario no pertenece a la disponibilidad configurada.';
  END IF;
  IF NOT slot_available THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='El horario solicitado no está disponible.';
  END IF;
  IF (appointment.barber_member_id,appointment.start_at,appointment.end_at)
    IS DISTINCT FROM (p_barber_member_id,p_start_at,finish) THEN
    UPDATE public.appointments SET barber_member_id=p_barber_member_id,start_at=p_start_at,end_at=finish
      WHERE id=appointment.id RETURNING * INTO appointment;
  END IF;
  RETURN pg_catalog.to_jsonb(appointment);
END;
$$;

REVOKE ALL ON FUNCTION public.change_appointment_status(uuid,uuid,text),
  public.update_appointment_notes(uuid,uuid,text),
  public.reschedule_appointment(uuid,uuid,uuid,timestamptz,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.change_appointment_status(uuid,uuid,text),
  public.update_appointment_notes(uuid,uuid,text),
  public.reschedule_appointment(uuid,uuid,uuid,timestamptz,integer) TO authenticated;

COMMIT;
