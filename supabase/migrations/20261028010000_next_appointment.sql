-- BF-261: smallest authorized future appointment, using the database clock and normal RLS.
BEGIN;

CREATE FUNCTION public.get_next_appointment(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCESS_DENIED';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'id', a.id,
    'business_id', a.business_id,
    'client_id', a.client_id,
    'barber_member_id', a.barber_member_id,
    'start_at', a.start_at,
    'end_at', a.end_at,
    'status', a.status,
    'notes', a.notes,
    'created_by', a.created_by,
    'created_at', a.created_at,
    'updated_at', a.updated_at
  ) INTO result
  FROM public.appointments AS a
  WHERE a.business_id = p_business_id
    AND a.status IN ('PENDING', 'CONFIRMED')
    AND a.start_at >= pg_catalog.now()
  ORDER BY a.start_at ASC, a.id ASC
  LIMIT 1;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_appointment(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_appointment(uuid) TO authenticated;

COMMIT;
