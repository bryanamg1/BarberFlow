BEGIN;

CREATE POLICY purchases_select_owners
ON public.purchases
FOR SELECT
TO authenticated
USING (public.has_business_role(business_id, ARRAY['OWNER']));

-- Ownership comes from the purchase, never from the product or line creator.
-- Keep OWNER authorization explicit in addition to the parent's SELECT RLS.
CREATE POLICY purchase_items_select_owners
ON public.purchase_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.purchases AS purchase
    WHERE purchase.id = purchase_items.purchase_id
      AND public.has_business_role(purchase.business_id, ARRAY['OWNER'])
  )
);

-- All direct writes remain denied in DRAFT, COMPLETED and VOIDED alike.
-- Future completion/correction workflows own the transactional side effects.
COMMIT;
