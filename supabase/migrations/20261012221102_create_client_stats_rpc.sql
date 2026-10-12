-- BF-245: one aggregate-only read exception; existing table RLS stays intact.
BEGIN;

CREATE FUNCTION public.get_client_stats(p_business_id uuid, p_client_id uuid)
RETURNS TABLE (
  total_appointments bigint,
  completed_visits bigint,
  no_show_count bigint,
  last_visit_at timestamptz,
  next_appointment_at timestamptz,
  total_spent numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 1
AS $$
DECLARE
  caller_is_owner boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CLIENT_ACCESS_DENIED';
  END IF;
  IF p_business_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INPUT';
  END IF;

  caller_is_owner := public.has_business_role(p_business_id, ARRAY['OWNER']);
  IF NOT caller_is_owner
     AND NOT public.has_business_role(p_business_id, ARRAY['BARBER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CLIENT_ACCESS_DENIED';
  END IF;

  -- Authorize before checking existence; foreign and missing IDs are identical.
  -- Archived clients remain valid, as do businesses allowed by the helper.
  IF NOT EXISTS (
    SELECT 1 FROM public.clients AS client
    WHERE client.id = p_client_id AND client.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CLIENT_NOT_FOUND';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE appointment.status = 'COMPLETED'),
         count(*) FILTER (WHERE appointment.status = 'NO_SHOW'),
         max(appointment.start_at) FILTER (WHERE appointment.status = 'COMPLETED'),
         min(appointment.start_at) FILTER (
           WHERE appointment.start_at > now()
             AND appointment.status IN ('PENDING', 'CONFIRMED')
         )
    INTO total_appointments, completed_visits, no_show_count,
         last_visit_at, next_appointment_at
    FROM public.appointments AS appointment
    WHERE appointment.business_id = p_business_id
      AND appointment.client_id = p_client_id;

  -- Deliberately do not query sales for BARBER. NULL is hidden, not zero spend.
  total_spent := NULL;
  IF caller_is_owner THEN
    SELECT COALESCE(sum(sale.total), 0.00::numeric)
      INTO total_spent
      FROM public.sales AS sale
      WHERE sale.business_id = p_business_id
        AND sale.client_id = p_client_id
        AND sale.status = 'COMPLETED';
  END IF;

  -- STABLE reads share the calling statement snapshot. No joins can multiply
  -- totals, no appointment fallback attribution, and no numeric(12,2) SUM cap.
  RETURN NEXT;
END;
$$;

-- Migration owner follows the existing postgres-owned helpers. Restrict the
-- default Supabase function ACL atomically, including service_role's default.
REVOKE ALL ON FUNCTION public.get_client_stats(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_client_stats(uuid, uuid) TO authenticated;

COMMIT;
