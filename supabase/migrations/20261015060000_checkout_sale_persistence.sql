BEGIN;

-- BF182 persists only the sale header. This internal server slice is NOT a
-- checkout endpoint: the future writer must finish every effect in the same
-- transaction before commit. Amounts come from its authoritative SQL calculation,
-- never from extra fields in the public checkout DTO.
CREATE FUNCTION private.persist_checkout_sale(
  p_business_id uuid,
  p_operation_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric
)
RETURNS public.sales
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result public.sales%ROWTYPE;
  resolved_client uuid := p_client_id;
  appointment_client uuid;
  appointment_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry checkout in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;

  -- The future orchestrator uses this same key before parent/product locks.
  -- Re-acquiring locks already owned by this transaction does not release them.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:checkout:' || p_business_id::text || ':' || p_operation_id::text, 0));
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT s.id, s.business_id, s.client_id, s.appointment_id, s.operation_id,
         s.status, s.subtotal, s.discount, s.total, s.sold_at, s.created_by, s.created_at, s.updated_at
    INTO result
  FROM public.sales AS s
  WHERE s.business_id = p_business_id AND s.operation_id = p_operation_id;
  IF FOUND THEN
    -- Do not turn a committed legacy draft into a completed sale. Authorized
    -- replay keeps historical amounts/actor/status, even if new input differs.
    IF result.status = 'DRAFT' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    IF (result.client_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.clients AS c WHERE c.id = result.client_id AND c.business_id = p_business_id))
       OR (result.appointment_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.appointments AS a WHERE a.id = result.appointment_id AND a.business_id = p_business_id)) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
    END IF;
    RETURN result;
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    SELECT a.client_id, a.status INTO appointment_client, appointment_status
    FROM public.appointments AS a
    WHERE a.id = p_appointment_id AND a.business_id = p_business_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
    END IF;
    IF appointment_status NOT IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')
       OR EXISTS (SELECT 1 FROM public.sales AS s WHERE s.business_id = p_business_id
                  AND s.appointment_id = p_appointment_id AND s.status IN ('COMPLETED', 'VOIDED')) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Appointment is not eligible for checkout', DETAIL = 'INVALID_APPOINTMENT_STATUS';
    END IF;
    IF p_client_id IS NOT NULL AND p_client_id <> appointment_client THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
    END IF;
    resolved_client := appointment_client;
  END IF;
  IF resolved_client IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clients AS c WHERE c.id = resolved_client AND c.business_id = p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  IF p_subtotal IS NULL OR p_discount IS NULL OR p_total IS NULL
     OR NOT (p_subtotal BETWEEN 0 AND 9999999999.99 AND p_subtotal <> 'NaN'::numeric AND p_subtotal = pg_catalog.trunc(p_subtotal, 2))
     OR NOT (p_discount BETWEEN 0 AND 9999999999.99 AND p_discount <> 'NaN'::numeric AND p_discount = pg_catalog.trunc(p_discount, 2))
     OR NOT (p_total BETWEEN 0 AND 9999999999.99 AND p_total <> 'NaN'::numeric AND p_total = pg_catalog.trunc(p_total, 2))
     OR p_discount > p_subtotal OR p_total <> p_subtotal - p_discount THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid checkout', DETAIL = 'INVALID_CHECKOUT';
  END IF;
  -- Includes identity loss during a parent-lock wait; no new client write grants.
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;

  INSERT INTO public.sales (
    business_id, operation_id, client_id, appointment_id, status,
    subtotal, discount, total, sold_at, created_by
  ) VALUES (
    p_business_id, p_operation_id, resolved_client, p_appointment_id, 'COMPLETED',
    p_subtotal, p_discount, p_total, now(), auth.uid()
  ) RETURNING id, business_id, client_id, appointment_id, operation_id,
              status, subtotal, discount, total, sold_at, created_by, created_at, updated_at
    INTO result;
  -- Existing financial-currency coordination/FK checks can also wait during
  -- INSERT. Identity loss while waiting must roll back this header as well.
  IF NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied', DETAIL = 'CHECKOUT_ACCESS_DENIED';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION private.persist_checkout_sale(uuid, uuid, uuid, uuid, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
