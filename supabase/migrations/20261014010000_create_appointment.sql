BEGIN;

-- Operational writes now belong to checked RPCs; SELECT policies remain intact.
DROP POLICY appointments_insert_authorized ON public.appointments;
DROP POLICY appointments_update_authorized ON public.appointments;
DROP POLICY appointment_services_insert_authorized ON public.appointment_services;
DROP POLICY appointment_services_update_authorized ON public.appointment_services;
DROP POLICY appointment_services_delete_authorized ON public.appointment_services;
REVOKE INSERT, UPDATE, DELETE ON public.appointments, public.appointment_services FROM anon, authenticated;
-- Explicit column grants survive a table-level REVOKE.
REVOKE UPDATE (id,business_id,client_id,barber_member_id,start_at,end_at,status,notes,created_by,created_at,updated_at)
  ON public.appointments FROM anon, authenticated;
REVOKE UPDATE (id,appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total,created_at)
  ON public.appointment_services FROM anon, authenticated;

CREATE FUNCTION public.create_appointment_with_services(
  p_appointment_id uuid, p_business_id uuid, p_client_id uuid,
  p_barber_member_id uuid, p_start_at timestamptz, p_service_items jsonb,
  p_duration_override integer DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_member public.business_members%ROWTYPE;
  target public.business_members%ROWTYPE;
  prior public.appointments%ROWTYPE;
  catalog public.services%ROWTYPE;
  item jsonb; items jsonb := '[]'::jsonb; snapshots jsonb := '[]'::jsonb;
  service_id uuid; quantity_value numeric; duration_sum numeric := 0;
  duration_value integer; total_value numeric; zone text; day_value date;
  finish timestamptz; slot_available boolean; result jsonb;
BEGIN
  IF actor IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER','BARBER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
  END IF;
  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa los datos del turno.';
  END IF;

  -- Lock order: request UUID, calendar key, business, memberships (sorted),
  -- client, catalog (sorted), settings, hours. Future scheduling writers must
  -- share hashtextextended('barberflow:calendar:' || business || ':' || member,0).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('barberflow:appointment-request:'||p_appointment_id::text,0));
  SELECT * INTO prior FROM public.appointments WHERE id=p_appointment_id;
  IF FOUND THEN
    IF prior.business_id IS DISTINCT FROM p_business_id OR prior.created_by IS DISTINCT FROM actor
      OR NOT (public.has_business_role(p_business_id,ARRAY['OWNER']) OR EXISTS (
        SELECT 1 FROM public.business_members m WHERE m.id=prior.barber_member_id
          AND m.business_id=p_business_id AND m.user_id=actor AND m.role='BARBER' AND m.is_active
      )) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
    END IF;
    -- Replay returns persisted history, not a recalculation or payload comparison.
  ELSE
    -- An advisory wait cannot refresh a repeatable-read transaction snapshot.
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Reintenta la operación del turno.';
    END IF;
    IF p_client_id IS NULL OR p_barber_member_id IS NULL OR p_start_at IS NULL
      OR NOT pg_catalog.isfinite(p_start_at) OR p_start_at<'0001-01-01T00:00:00Z'::timestamptz
      OR p_start_at>='10000-01-01T00:00:00Z'::timestamptz
      OR p_duration_override<=0 OR p_service_items IS NULL
      OR pg_catalog.jsonb_typeof(p_service_items)<>'array' THEN
      RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa los datos del turno.';
    END IF;
    IF pg_catalog.jsonb_array_length(p_service_items)=0 THEN
      RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Agrega al menos un servicio.';
    END IF;
    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_service_items) LOOP
      IF pg_catalog.jsonb_typeof(item)<>'object'
        OR pg_catalog.jsonb_typeof(item->'service_id') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa los servicios del turno.';
      END IF;
      BEGIN service_id := (item->>'service_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa los servicios del turno.';
      END;
      quantity_value := (item->>'quantity')::numeric;
      IF quantity_value<1 OR quantity_value>2147483647 OR quantity_value<>pg_catalog.trunc(quantity_value) THEN
        RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa la cantidad del servicio.';
      END IF;
      -- Only these two caller fields are consumed; snapshots/status/creator are server owned.
      items := items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('service_id',service_id,'quantity',quantity_value::integer));
    END LOOP;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('barberflow:calendar:'||p_business_id::text||':'||p_barber_member_id::text,0));
    SELECT b.timezone INTO zone FROM public.businesses b WHERE b.id=p_business_id FOR SHARE;
    -- Freeze authorization and active references while validating/persisting.
    PERFORM 1 FROM public.business_members m WHERE m.business_id=p_business_id
      AND (m.user_id=actor OR m.id=p_barber_member_id) ORDER BY m.id FOR SHARE;
    SELECT * INTO actor_member FROM public.business_members m
      WHERE m.business_id=p_business_id AND m.user_id=actor AND m.is_active;
    SELECT * INTO target FROM public.business_members m
      WHERE m.id=p_barber_member_id AND m.business_id=p_business_id AND m.is_active AND m.role IN ('OWNER','BARBER');
    IF actor_member.id IS NULL OR target.id IS NULL
      OR actor_member.role NOT IN ('OWNER','BARBER')
      OR (actor_member.role='BARBER' AND target.user_id<>actor)
      OR (p_duration_override IS NOT NULL AND actor_member.role<>'OWNER') THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='No se pudo acceder al turno.';
    END IF;
    PERFORM 1 FROM public.clients c WHERE c.id=p_client_id AND c.business_id=p_business_id AND c.is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa las referencias del turno.'; END IF;
    PERFORM 1 FROM public.services s WHERE s.id IN (SELECT (i.value->>'service_id')::uuid FROM pg_catalog.jsonb_array_elements(items) i)
      AND s.business_id=p_business_id ORDER BY s.id FOR SHARE;
    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(items) LOOP
      SELECT * INTO catalog FROM public.services s
        WHERE s.id=(item->>'service_id')::uuid AND s.business_id=p_business_id AND s.is_active;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='Revisa las referencias del turno.'; END IF;
      quantity_value := (item->>'quantity')::numeric;
      total_value := catalog.price * quantity_value;
      IF total_value>9999999999.99 THEN
        RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='El importe del servicio supera el máximo permitido.';
      END IF;
      duration_sum := duration_sum + catalog.duration_minutes::numeric * quantity_value;
      snapshots := snapshots || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'service_id',catalog.id,'service_name_snapshot',catalog.name,'unit_price_snapshot',catalog.price,
        'duration_minutes_snapshot',catalog.duration_minutes,'quantity',quantity_value::integer,'line_total',total_value));
    END LOOP;
    IF p_duration_override IS NULL AND duration_sum>2147483647 THEN
      RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='La duración supera el máximo permitido.';
    END IF;
    duration_value := coalesce(p_duration_override,duration_sum::integer);
    -- These locks prevent concurrent settings/hour edits from invalidating the check.
    PERFORM 1 FROM public.business_settings WHERE business_id=p_business_id FOR SHARE;
    IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names t WHERE lower(t.name)=lower(zone)) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='La configuración horaria no está disponible.';
    END IF;
    day_value := (p_start_at AT TIME ZONE zone)::date;
    PERFORM 1 FROM public.business_hours WHERE business_id=p_business_id
      AND day_of_week=extract(dow FROM day_value)::integer FOR SHARE;
    -- Reuse BF-144 after acquiring the calendar lock, with a fresh RC snapshot.
    SELECT s.end_at,s.available INTO finish,slot_available FROM public.get_availability(
      p_business_id,p_barber_member_id,day_value,duration_value,NULL) s WHERE s.start_at=p_start_at;
    IF finish IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='PT422', MESSAGE='El horario no pertenece a la disponibilidad configurada.';
    END IF;
    IF NOT slot_available THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='El horario solicitado no está disponible.';
    END IF;
    INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,notes,created_by)
      VALUES(p_appointment_id,p_business_id,p_client_id,p_barber_member_id,p_start_at,finish,'PENDING',p_notes,actor);
    INSERT INTO public.appointment_services(appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total)
      SELECT p_appointment_id,(s.value->>'service_id')::uuid,s.value->>'service_name_snapshot',
        (s.value->>'unit_price_snapshot')::numeric,(s.value->>'duration_minutes_snapshot')::integer,
        (s.value->>'quantity')::integer,(s.value->>'line_total')::numeric
      FROM pg_catalog.jsonb_array_elements(snapshots) WITH ORDINALITY s(value,position) ORDER BY s.position;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'id',a.id,'business_id',a.business_id,'client_id',a.client_id,'barber_member_id',a.barber_member_id,
    'start_at',a.start_at,'end_at',a.end_at,'status',a.status,'notes',a.notes,'created_by',a.created_by,
    'created_at',a.created_at,'updated_at',a.updated_at,'appointment_services',coalesce((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',s.id,'appointment_id',s.appointment_id,'service_id',s.service_id,'service_name_snapshot',s.service_name_snapshot,
        'unit_price_snapshot',s.unit_price_snapshot,'duration_minutes_snapshot',s.duration_minutes_snapshot,
        'quantity',s.quantity,'line_total',s.line_total,'created_at',s.created_at) ORDER BY s.id)
      FROM public.appointment_services s WHERE s.appointment_id=a.id),'[]'::jsonb)
  ) INTO result FROM public.appointments a WHERE a.id=p_appointment_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_appointment_with_services(uuid,uuid,uuid,uuid,timestamptz,jsonb,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_appointment_with_services(uuid,uuid,uuid,uuid,timestamptz,jsonb,integer,text) TO authenticated;

COMMIT;
