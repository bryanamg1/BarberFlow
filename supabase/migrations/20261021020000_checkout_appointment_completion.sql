BEGIN;

-- Internal BF186 slice. BF188 must compose every stage on the SAME connection
-- and transaction, taking the operation/linked appointment before products.
-- The persisted sale association is the existing checkout idempotency resource;
-- no independent completion operation/table or public partial success exists.
CREATE FUNCTION private.complete_checkout_appointment(p_business_id uuid, p_operation_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  sale public.sales%ROWTYPE;
  appointment public.appointments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Checkout access denied', DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry checkout in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid checkout', DETAIL='INVALID_CHECKOUT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:checkout:'||p_business_id::text||':'||p_operation_id::text,0));
  SELECT s.* INTO sale FROM public.sales s
    WHERE s.business_id=p_business_id AND s.operation_id=p_operation_id FOR UPDATE;
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Checkout access denied', DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF sale.id IS NULL OR sale.status='DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid checkout', DETAIL='INVALID_CHECKOUT';
  END IF;
  IF sale.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c
    WHERE c.id=sale.client_id AND c.business_id=p_business_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Checkout access denied', DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF sale.appointment_id IS NULL THEN RETURN NULL; END IF;

  -- New checkout: BF182 already owns this row before financial business locks.
  -- Legacy/replay composition can arrive after such locks. Never wait on a row
  -- or calendar held by an operational writer that may itself await business
  -- currency coordination: fail/retry the WHOLE outer transaction instead.
  BEGIN
    SELECT a.* INTO appointment FROM public.appointments a
      WHERE a.id=sale.appointment_id AND a.business_id=p_business_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry checkout in a fresh transaction';
  END;
  IF appointment.id IS NULL OR sale.client_id IS DISTINCT FROM appointment.client_id THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Checkout access denied', DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:calendar:'||p_business_id::text||':'||appointment.barber_member_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Retry checkout in a fresh transaction';
  END IF;
  PERFORM 1 FROM public.business_members m WHERE m.business_id=p_business_id
    AND m.user_id=auth.uid() ORDER BY m.id FOR SHARE;
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Checkout access denied', DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales s WHERE s.business_id=p_business_id
    AND s.appointment_id=appointment.id AND s.id<>sale.id AND s.status IN ('COMPLETED','VOIDED')) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Appointment is not eligible for checkout', DETAIL='INVALID_APPOINTMENT_STATUS';
  END IF;
  -- Only this persisted operation can replay its original completion. BF182
  -- rejects a NEW operation against COMPLETED before inserting another sale.
  IF appointment.status='COMPLETED' THEN RETURN appointment; END IF;
  IF sale.status<>'COMPLETED' OR appointment.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Appointment is not eligible for checkout', DETAIL='INVALID_APPOINTMENT_STATUS';
  END IF;
  UPDATE public.appointments SET status='COMPLETED' WHERE id=appointment.id RETURNING * INTO appointment;
  RETURN appointment;
END;
$$;
REVOKE ALL ON FUNCTION private.complete_checkout_appointment(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
