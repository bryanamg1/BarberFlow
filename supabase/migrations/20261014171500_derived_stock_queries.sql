BEGIN;

-- Read-only producers for the frozen BF-220 transport. RLS remains authoritative.
CREATE FUNCTION public.get_product_stock(p_business_id uuid, p_product_ids uuid[])
RETURNS TABLE (product_id uuid, current_stock text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Inventory access denied' USING ERRCODE = '42501';
  END IF;
  IF p_product_ids IS NULL OR array_position(p_product_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid inventory parameters' USING ERRCODE = '22023';
  END IF;

  -- ANY naturally returns each physical product once, irrespective of input duplicates.
  -- An archived product remains readable here; operational alerts exclude it below.
  RETURN QUERY
  SELECT product.id, coalesce(balance.quantity, 0::bigint)::text
  FROM public.products AS product
  CROSS JOIN LATERAL (
    SELECT sum(movement.quantity_delta) AS quantity
    FROM public.stock_movements AS movement
    WHERE movement.business_id = p_business_id
      AND movement.product_id = product.id
  ) AS balance
  WHERE product.business_id = p_business_id AND product.id = ANY(p_product_ids)
  ORDER BY product.id ASC;
END;
$$;

CREATE FUNCTION public.get_low_stock_products(p_business_id uuid, p_page integer, p_page_size integer)
RETURNS TABLE (product_id uuid, name text, minimum_stock integer, current_stock text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Inventory access denied' USING ERRCODE = '42501';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'Invalid inventory parameters' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT product.id, product.name, product.minimum_stock,
         coalesce(balance.quantity, 0::bigint)::text
  FROM public.products AS product
  CROSS JOIN LATERAL (
    SELECT sum(movement.quantity_delta) AS quantity
    FROM public.stock_movements AS movement
    WHERE movement.business_id = p_business_id
      AND movement.product_id = product.id
  ) AS balance
  WHERE product.business_id = p_business_id AND product.is_active
    AND coalesce(balance.quantity, 0::bigint) <= product.minimum_stock
  ORDER BY product.name ASC, product.id ASC
  LIMIT (p_page_size::bigint + 1)
  OFFSET ((p_page::bigint - 1) * p_page_size::bigint);
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_stock(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_low_stock_products(uuid, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_stock(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_low_stock_products(uuid, integer, integer) TO authenticated;

COMMIT;
