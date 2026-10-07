BEGIN;

-- BF-076: active members read the complete catalog, including archived rows.
-- Only OWNER administers it; physical deletion has no client policy.
CREATE POLICY product_categories_select_members ON public.product_categories
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY product_categories_insert_owners ON public.product_categories
  FOR INSERT TO authenticated WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));
CREATE POLICY product_categories_update_owners ON public.product_categories
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['OWNER']));

CREATE POLICY products_select_members ON public.products
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY products_insert_owners ON public.products
  FOR INSERT TO authenticated WITH CHECK (
    public.has_business_role(business_id, ARRAY['OWNER'])
    AND (category_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_categories category
      WHERE category.id = products.category_id
        AND category.business_id = products.business_id
    ))
  );
CREATE POLICY products_update_owners ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['OWNER']))
  WITH CHECK (
    public.has_business_role(business_id, ARRAY['OWNER'])
    AND (category_id IS NULL OR EXISTS (
      SELECT 1 FROM public.product_categories category
      WHERE category.id = products.category_id
        AND category.business_id = products.business_id
    ))
  );

-- All five movement types remain visible. Future controlled workflows create
-- movements; no client INSERT/UPDATE/DELETE policy or ledger trigger change.
CREATE POLICY stock_movements_select_members ON public.stock_movements
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));

-- A caller can own both tenants. Row predicates alone cannot prevent transfers.
-- Preserve UPDATE on every other existing column, following BF-073–BF-075.
REVOKE UPDATE ON public.product_categories, public.products FROM authenticated;
GRANT UPDATE (id, name, is_active, created_at, updated_at)
  ON public.product_categories TO authenticated;
GRANT UPDATE (id, category_id, name, description, sku, sale_price,
              default_purchase_cost, minimum_stock, is_active, created_at, updated_at)
  ON public.products TO authenticated;

COMMIT;
