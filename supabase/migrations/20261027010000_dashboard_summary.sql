-- BF-240: read-only financial summary; no history, writer or policy changes.
BEGIN;

CREATE FUNCTION public.get_dashboard_summary(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  expense_summary jsonb;
  revenue numeric;
  service_revenue numeric;
  product_revenue numeric;
  product_cogs numeric;
  products_sold numeric;
  sales_count bigint;
  invalid_history boolean;
  appointment_count bigint;
  cancellation_count bigint;
  no_show_count bigint;
  client_count bigint;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCESS_DENIED';
  END IF;
  IF (p_from IS NULL) <> (p_to IS NULL)
     OR (p_from IS NOT NULL AND
       (NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from >= p_to)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INPUT';
  END IF;

  -- Undated COMPLETED history cannot be assigned to any range. Check the
  -- authorized business even for bounded requests; never infer another date.
  IF EXISTS (
    SELECT 1 FROM public.sales AS s
    WHERE s.business_id = p_business_id AND s.status = 'COMPLETED' AND s.sold_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid history', DETAIL = 'INVALID_HISTORY';
  END IF;

  WITH eligible_sales AS MATERIALIZED (
    SELECT s.id, s.subtotal, s.discount, s.total
    FROM public.sales AS s
    WHERE s.business_id = p_business_id AND s.status = 'COMPLETED'
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to IS NULL OR s.sold_at < p_to)
  ), cumulative_lines AS (
    SELECT i.id, i.sale_id, i.item_type, i.line_total, i.quantity, i.unit_cost_snapshot,
      s.subtotal, s.discount,
      sum(i.line_total) OVER (
        PARTITION BY i.sale_id ORDER BY i.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cumulative_gross
    FROM eligible_sales AS s
    JOIN public.sale_items AS i ON i.sale_id = s.id
  ), allocated_lines AS (
    SELECT l.*,
      CASE WHEN l.subtotal = 0 THEN 0.00
        ELSE round(l.discount * l.cumulative_gross / l.subtotal, 2)
          - round(l.discount * (l.cumulative_gross - l.line_total) / l.subtotal, 2)
      END AS line_discount
    FROM cumulative_lines AS l
  ), per_sale AS (
    SELECT s.id,
      COALESCE(sum(l.line_total - l.line_discount), 0.00) AS net,
      COALESCE(sum(l.line_total - l.line_discount) FILTER (WHERE l.item_type = 'SERVICE'), 0.00) AS service_net,
      COALESCE(sum(l.line_total - l.line_discount) FILTER (WHERE l.item_type = 'PRODUCT'), 0.00) AS product_net,
      COALESCE(sum(l.unit_cost_snapshot * l.quantity) FILTER (WHERE l.item_type = 'PRODUCT'), 0.00) AS cogs,
      COALESCE(sum(l.quantity::numeric) FILTER (WHERE l.item_type = 'PRODUCT'), 0) AS product_quantity,
      count(l.id) = 0
        OR COALESCE(sum(l.line_total), 0.00) <> s.subtotal
        OR COALESCE(sum(l.line_discount), 0.00) <> s.discount
        OR COALESCE(sum(l.line_total - l.line_discount), 0.00) <> s.total
        OR COALESCE(bool_or(l.line_discount < 0 OR l.line_discount > l.line_total), false) AS invalid
    FROM eligible_sales AS s
    LEFT JOIN allocated_lines AS l ON l.sale_id = s.id
    GROUP BY s.id, s.subtotal, s.discount, s.total
  )
  SELECT COALESCE(sum(s.net), 0.00), COALESCE(sum(s.service_net), 0.00),
    COALESCE(sum(s.product_net), 0.00), COALESCE(sum(s.cogs), 0.00),
    COALESCE(sum(s.product_quantity), 0), count(*), COALESCE(bool_or(s.invalid), false)
  INTO revenue, service_revenue, product_revenue, product_cogs, products_sold, sales_count, invalid_history
  FROM per_sale AS s;
  IF invalid_history THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid history', DETAIL = 'INVALID_HISTORY';
  END IF;

  -- BF-242 remains the single owner of expense eligibility, business-local
  -- civil dates and retroactive exclusion of expenses belonging to VOIDED purchases.
  expense_summary := public.get_expense_summary(p_business_id, p_from, p_to);

  SELECT count(*), count(*) FILTER (WHERE a.status = 'CANCELLED'),
    count(*) FILTER (WHERE a.status = 'NO_SHOW')
  INTO appointment_count, cancellation_count, no_show_count
  FROM public.appointments AS a
  WHERE a.business_id = p_business_id
    AND (p_from IS NULL OR a.start_at >= p_from)
    AND (p_to IS NULL OR a.start_at < p_to);
  SELECT count(*) INTO client_count FROM public.clients AS c
  WHERE c.business_id = p_business_id AND c.is_active;

  RETURN jsonb_build_object(
    'total_revenue', round(revenue, 2)::text,
    'service_revenue', round(service_revenue, 2)::text,
    'product_revenue', round(product_revenue, 2)::text,
    'expenses', expense_summary->>'manual_total',
    'merchandise_purchases', expense_summary->>'purchase_total',
    'profit', round(revenue - product_cogs - (expense_summary->>'manual_total')::numeric, 2)::text,
    'appointments', appointment_count::text,
    'active_clients', client_count::text,
    'average_ticket', CASE WHEN sales_count = 0 THEN NULL ELSE round(revenue / sales_count, 2)::text END,
    'products_sold', products_sold::text,
    'cancellations', cancellation_count::text,
    'no_shows', no_show_count::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary(uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid,timestamptz,timestamptz)
  TO authenticated;

COMMIT;
