BEGIN;

CREATE POLICY expense_categories_select_owners ON public.expense_categories
  FOR SELECT TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY expense_categories_insert_owners ON public.expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY expense_categories_update_owners ON public.expense_categories
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));

-- Visibility alone is insufficient for OWNER AB: both references must match
-- the expense tenant, even for legacy or privileged inconsistent records.
CREATE POLICY expenses_select_owners ON public.expenses
  FOR SELECT TO authenticated
  USING (
    public.has_business_role(business_id, ARRAY['OWNER'])
    AND EXISTS (
      SELECT 1 FROM public.expense_categories category
      WHERE category.id = expenses.category_id
        AND category.business_id = expenses.business_id
    )
    AND (source_type = 'MANUAL' OR EXISTS (
      SELECT 1 FROM public.purchases purchase
      WHERE purchase.id = expenses.purchase_id
        AND purchase.business_id = expenses.business_id
    ))
  );
CREATE POLICY expenses_insert_manual_owners ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_business_role(business_id, ARRAY['OWNER'])
    AND source_type = 'MANUAL'
    AND purchase_id IS NULL
    AND created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.expense_categories category
      WHERE category.id = expenses.category_id
        AND category.business_id = expenses.business_id
    )
  );
CREATE POLICY expenses_update_manual_owners ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    public.has_business_role(business_id, ARRAY['OWNER'])
    AND source_type = 'MANUAL'
    AND purchase_id IS NULL
  )
  WITH CHECK (
    public.has_business_role(business_id, ARRAY['OWNER'])
    AND source_type = 'MANUAL'
    AND purchase_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.expense_categories category
      WHERE category.id = expenses.category_id
        AND category.business_id = expenses.business_id
    )
  );

-- Preserve the existing category column-grant pattern; even OWNER AB cannot
-- transfer a category. No DELETE policies; archive categories through is_active.
REVOKE UPDATE ON public.expense_categories FROM authenticated;
GRANT UPDATE (id, name, is_active, created_at, updated_at)
  ON public.expense_categories TO authenticated;

-- Exactly the approved MANUAL fields. updated_at is written by the existing
-- BEFORE UPDATE trigger, never supplied by the client through UPDATE.
REVOKE UPDATE ON public.expenses FROM authenticated;
GRANT UPDATE (category_id, description, amount, payment_method, expense_date, receipt_path, notes)
  ON public.expenses TO authenticated;

COMMIT;
