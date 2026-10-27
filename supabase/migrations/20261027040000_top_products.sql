-- BF-244: immutable PRODUCT snapshots, exact net attribution and stable ranking.
BEGIN;

CREATE FUNCTION public.get_top_products(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  product_id uuid,
  name text,
  quantity bigint,
  net_revenue text,
  cogs text,
  gross_profit text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  ranked_row record;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCESS_DENIED';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_from IS NULL) <> (p_to IS NULL)
     OR (p_from IS NOT NULL AND
       (NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from >= p_to)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INPUT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales AS s
    WHERE s.business_id = p_business_id AND s.status = 'COMPLETED' AND s.sold_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid history', DETAIL = 'INVALID_HISTORY';
  END IF;

  -- Allocate across ALL historical lines before selecting PRODUCT. One cursor
  -- checks global integrity even when the requested type has no output rows.
  FOR ranked_row IN
    WITH eligible_sales AS MATERIALIZED (
      SELECT s.id, s.sold_at, s.subtotal, s.discount, s.total
      FROM public.sales AS s
      WHERE s.business_id = p_business_id AND s.status = 'COMPLETED'
        AND (p_from IS NULL OR s.sold_at >= p_from)
        AND (p_to IS NULL OR s.sold_at < p_to)
    ), cumulative_lines AS (
      SELECT i.id, i.sale_id, i.item_type, i.product_id, i.item_name_snapshot,
        i.quantity, i.line_total, i.unit_cost_snapshot, s.sold_at, s.subtotal, s.discount,
        sum(i.line_total) OVER (
          PARTITION BY i.sale_id ORDER BY i.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_gross
      FROM eligible_sales AS s JOIN public.sale_items AS i ON i.sale_id = s.id
    ), allocated_lines AS (
      SELECT l.*,
        CASE WHEN l.subtotal = 0 THEN 0.00
          ELSE round(l.discount * l.cumulative_gross / l.subtotal, 2)
            - round(l.discount * (l.cumulative_gross - l.line_total) / l.subtotal, 2)
        END AS line_discount
      FROM cumulative_lines AS l
    ), per_sale AS (
      SELECT s.id,
        count(l.id) = 0
          OR COALESCE(sum(l.line_total), 0.00) <> s.subtotal
          OR COALESCE(sum(l.line_discount), 0.00) <> s.discount
          OR COALESCE(sum(l.line_total - l.line_discount), 0.00) <> s.total
          OR COALESCE(bool_or(l.line_discount < 0 OR l.line_discount > l.line_total), false) AS invalid
      FROM eligible_sales AS s LEFT JOIN allocated_lines AS l ON l.sale_id = s.id
      GROUP BY s.id, s.subtotal, s.discount, s.total
    ), target_lines AS (
      SELECT l.* FROM allocated_lines AS l WHERE l.item_type = 'PRODUCT'
    ), integrity AS (
      SELECT COALESCE((SELECT bool_or(s.invalid) FROM per_sale AS s), false)
        OR COALESCE((SELECT bool_or(l.product_id IS NULL OR l.item_name_snapshot IS NULL
          OR length(trim(l.item_name_snapshot)) = 0 OR l.unit_cost_snapshot IS NULL
          OR l.unit_cost_snapshot < 0 OR l.unit_cost_snapshot = 'NaN'::numeric) FROM target_lines AS l), false) AS invalid
    ), totals AS (
      SELECT l.product_id AS entity_id, sum(l.quantity) AS units,
        sum(l.line_total - l.line_discount) AS net,
        sum(l.unit_cost_snapshot * l.quantity) AS cost
      FROM target_lines AS l GROUP BY l.product_id
    ), latest_names AS (
      SELECT DISTINCT ON (l.product_id) l.product_id AS entity_id, l.item_name_snapshot AS snapshot_name
      FROM target_lines AS l ORDER BY l.product_id, l.sold_at DESC, l.id DESC
    ), ranked AS (
      SELECT t.entity_id, n.snapshot_name, t.units, t.net, t.cost
      FROM totals AS t JOIN latest_names AS n ON n.entity_id = t.entity_id
      ORDER BY t.net DESC, t.entity_id ASC LIMIT p_limit
    )
    SELECT r.entity_id, r.snapshot_name, r.units, r.net, r.cost, v.invalid
    FROM integrity AS v LEFT JOIN ranked AS r ON true
    ORDER BY r.net DESC, r.entity_id ASC
  LOOP
    IF ranked_row.invalid THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid history', DETAIL = 'INVALID_HISTORY';
    END IF;
    -- The left join supplies only an internal validation row for empty input.
    IF ranked_row.entity_id IS NOT NULL THEN
      product_id := ranked_row.entity_id;
      name := ranked_row.snapshot_name;
      quantity := ranked_row.units;
      net_revenue := round(ranked_row.net, 2)::text;
      cogs := round(ranked_row.cost, 2)::text;
      gross_profit := round(ranked_row.net - ranked_row.cost, 2)::text;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_products(uuid,timestamptz,timestamptz,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_products(uuid,timestamptz,timestamptz,integer)
  TO authenticated;

COMMIT;
