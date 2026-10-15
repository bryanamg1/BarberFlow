BEGIN;

-- BF-180 freezes the wire signature, not a partially working checkout.
-- Do not enable success or writes until BF-181–188 are complete and validated.
CREATE FUNCTION public.complete_checkout(
  p_business_id uuid,
  p_operation_id uuid,
  p_appointment_id uuid,
  p_client_id uuid,
  p_discount_amount numeric,
  p_payment_method text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Checkout access denied';
  END IF;
  RAISE EXCEPTION USING ERRCODE = '0A000', MESSAGE = 'Checkout is not available', DETAIL = 'CHECKOUT_NOT_READY';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_checkout(uuid, uuid, uuid, uuid, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_checkout(uuid, uuid, uuid, uuid, numeric, text, jsonb) TO authenticated;

COMMIT;
