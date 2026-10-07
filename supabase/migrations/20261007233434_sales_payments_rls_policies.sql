BEGIN;

CREATE POLICY sales_select_authorized
ON public.sales
FOR SELECT
TO authenticated
USING (
  public.has_business_role(business_id, ARRAY['OWNER'])
  OR (
    public.has_business_role(business_id, ARRAY['BARBER'])
    AND created_by = (SELECT auth.uid())
  )
);

-- Keep the parent authorization explicit, independently of sales SELECT RLS.
CREATE POLICY sale_items_select_authorized
ON public.sale_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales AS sale
    WHERE sale.id = sale_items.sale_id
      AND (
        public.has_business_role(sale.business_id, ARRAY['OWNER'])
        OR (
          public.has_business_role(sale.business_id, ARRAY['BARBER'])
          AND sale.created_by = (SELECT auth.uid())
        )
      )
  )
);

-- Approved BF-077 exception: this schema is not exposed through the API.
-- Creation intentionally fails if it already exists, requiring inspection.
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

-- The migration owner bypasses RLS on payments/sales. Checking permission inside
-- the helper prevents callers using arbitrary payment IDs as a tenant oracle.
-- A payment's creator may read it without gaining access to its parent's sale.
CREATE FUNCTION private.can_read_payment(target_payment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.payments AS payment
    JOIN public.sales AS sale
      ON sale.id = payment.sale_id
     AND sale.business_id = payment.business_id
    WHERE payment.id = target_payment_id
      AND (
        public.has_business_role(payment.business_id, ARRAY['OWNER'])
        OR (
          public.has_business_role(payment.business_id, ARRAY['BARBER'])
          AND payment.created_by = (SELECT auth.uid())
        )
      )
  );
$$;

-- Restrict Supabase default function ACLs atomically. No service_role policy or
-- changes to existing service_role grants are needed; it still bypasses RLS.
REVOKE ALL ON FUNCTION private.can_read_payment(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.can_read_payment(uuid) TO authenticated;

CREATE POLICY payments_select_authorized
ON public.payments
FOR SELECT
TO authenticated
USING (private.can_read_payment(id));

-- Direct writes remain closed, including OWNER and all sale statuses.
COMMIT;
