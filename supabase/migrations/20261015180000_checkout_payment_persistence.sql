BEGIN;

-- Forward-only, validated HD006 alignment. Never silently map financial history.
LOCK TABLE public.payments IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.payments WHERE payment_method NOT IN
      ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Payment method alignment requires review of existing history',
      DETAIL='PAYMENT_METHOD_ALIGNMENT_REQUIRED';
  END IF;
END $$;
ALTER TABLE public.payments DROP CONSTRAINT payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK(payment_method IN ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET'));

-- Only the internal payment slice. BF182/183 and all future checkout effects
-- must share one server transaction/connection; no public partial success.
CREATE FUNCTION private.persist_checkout_payment(
  p_business_id uuid,
  p_operation_id uuid,
  p_payment_method text
)
RETURNS SETOF public.payments
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sale public.sales%ROWTYPE;
  payment public.payments%ROWTYPE;
  payment_count bigint;
  item_count bigint;
  gross numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Retry checkout in a fresh transaction';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'barberflow:checkout:' || p_business_id::text || ':' || p_operation_id::text,0));
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT s.id,s.business_id,s.client_id,s.appointment_id,s.operation_id,s.status,
    s.subtotal,s.discount,s.total,s.sold_at,s.created_by,s.created_at,s.updated_at
    INTO sale FROM public.sales s
    WHERE s.business_id=p_business_id AND s.operation_id=p_operation_id FOR UPDATE;
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  IF sale.id IS NULL OR sale.status='DRAFT' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  IF (sale.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c
        WHERE c.id=sale.client_id AND c.business_id=p_business_id))
     OR (sale.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
        WHERE a.id=sale.appointment_id AND a.business_id=p_business_id)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  SELECT pg_catalog.count(*) INTO payment_count FROM public.payments p WHERE p.sale_id=sale.id;
  IF payment_count>0 THEN
    -- Existing checkout payment must be singular, tenant-consistent and full.
    -- Preserve its method/audit/notes; no new input or catalog validation on replay.
    IF payment_count<>1 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    SELECT p.id,p.business_id,p.sale_id,p.payment_method,p.amount,p.notes,p.paid_at,p.created_by,p.created_at
      INTO payment FROM public.payments p WHERE p.sale_id=sale.id;
    IF payment.business_id<>p_business_id OR sale.total<=0 OR payment.amount<>sale.total THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
    END IF;
    RETURN NEXT payment;
    RETURN;
  END IF;
  -- A historical VOIDED sale is never given a new payment. No legacy DRAFT resume.
  IF sale.status<>'COMPLETED' OR p_payment_method IS NULL OR p_payment_method NOT IN
      ('CASH','BANK_TRANSFER','DEBIT_CARD','CREDIT_CARD','DIGITAL_WALLET') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  -- Consume persisted gross snapshots only; never recalculate catalog prices/cost.
  SELECT pg_catalog.count(*),pg_catalog.sum(i.line_total) INTO item_count,gross
    FROM public.sale_items i WHERE i.sale_id=sale.id;
  IF item_count=0 OR gross IS DISTINCT FROM sale.subtotal THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout',DETAIL='INVALID_CHECKOUT';
  END IF;
  IF sale.total=0 THEN RETURN; END IF;

  INSERT INTO public.payments(business_id,sale_id,payment_method,amount,notes,created_by)
    VALUES(p_business_id,sale.id,p_payment_method,sale.total,NULL,auth.uid())
    RETURNING id,business_id,sale_id,payment_method,amount,notes,paid_at,created_by,created_at INTO payment;
  -- The existing currency coordination/FK checks may wait during INSERT.
  IF NOT public.has_business_role(p_business_id,ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Checkout access denied',DETAIL='CHECKOUT_ACCESS_DENIED';
  END IF;
  RETURN NEXT payment;
END;
$$;
REVOKE ALL ON FUNCTION private.persist_checkout_payment(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
