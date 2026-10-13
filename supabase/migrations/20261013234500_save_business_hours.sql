BEGIN;

-- BF-273 approved exception: atomic upsert without granting UPDATE(business_id).
CREATE FUNCTION public.save_business_hours(p_business_id uuid, p_days jsonb)
RETURNS TABLE (
  id uuid, business_id uuid, day_of_week smallint,
  open_time time, close_time time, is_closed boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  day_number numeric;
  time_pattern constant text := '^(?:(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,6})?)?|24:00(?::00(?:\.0{1,6})?)?)$';
BEGIN
  IF auth.uid() IS NULL OR public.has_business_role(p_business_id, ARRAY['OWNER']) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'No tienes acceso a esta configuración.';
  END IF;
  IF pg_catalog.jsonb_typeof(p_days) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Configura los siete días de la semana.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_days) <> 7 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Configura los siete días de la semana.';
  END IF;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_days) LOOP
    IF pg_catalog.jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(item->'day_of_week') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(item->'open_time') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(item->'close_time') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(item->'is_closed') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Revisa los datos de los horarios.';
    END IF;
    day_number := (item->>'day_of_week')::numeric;
    IF day_number < 0 OR day_number > 6 OR day_number <> pg_catalog.trunc(day_number)
       OR (item->>'open_time') !~ time_pattern OR (item->>'close_time') !~ time_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Revisa los datos de los horarios.';
    END IF;
    IF NOT (item->>'is_closed')::boolean
       AND (item->>'close_time')::time <= (item->>'open_time')::time THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'El cierre debe ser posterior a la apertura.';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'day_of_week')::numeric)
      FROM pg_catalog.jsonb_array_elements(p_days)) <> 7 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Configura cada día una sola vez.';
  END IF;

  RETURN QUERY
  INSERT INTO public.business_hours AS hours (business_id, day_of_week, open_time, close_time, is_closed)
  SELECT p_business_id, (entry.value->>'day_of_week')::numeric::smallint,
    (entry.value->>'open_time')::time, (entry.value->>'close_time')::time,
    (entry.value->>'is_closed')::boolean
  FROM pg_catalog.jsonb_array_elements(p_days) AS entry(value)
  ORDER BY (entry.value->>'day_of_week')::numeric
  ON CONFLICT ON CONSTRAINT business_hours_business_day_key DO UPDATE
    SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, is_closed = EXCLUDED.is_closed
  RETURNING hours.id, hours.business_id, hours.day_of_week, hours.open_time, hours.close_time, hours.is_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.save_business_hours(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_business_hours(uuid, jsonb) TO authenticated;

COMMIT;
