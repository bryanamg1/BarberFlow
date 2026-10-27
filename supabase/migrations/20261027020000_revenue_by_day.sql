-- BF-241: daily historical net revenue; no writers, history or policy changes.
BEGIN;

CREATE FUNCTION public.get_revenue_by_day(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  date date,
  service_revenue text,
  product_revenue text,
  total_revenue text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  business_timezone text;
  first_day date;
  last_day date;
  bucket record;
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
  SELECT b.timezone INTO business_timezone FROM public.businesses AS b WHERE b.id = p_business_id;
  IF business_timezone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCESS_DENIED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales AS s
    WHERE s.business_id = p_business_id AND s.status = 'COMPLETED' AND s.sold_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid history', DETAIL = 'INVALID_HISTORY';
  END IF;

  first_day := (p_from AT TIME ZONE business_timezone)::date;
  -- Timestamp precision is microseconds. The last included instant determines
  -- the final civil date: an exclusive local midnight does not add a phantom day.
  last_day := ((p_to - interval '1 microsecond') AT TIME ZONE business_timezone)::date;

  -- One SQL cursor over the final day spine, not a query/function per day or
  -- line. A shared integrity flag rejects the entire result before RETURN NEXT.
  FOR bucket IN
    WITH eligible_sales AS MATERIALIZED (
      SELECT s.id, s.subtotal, s.discount, s.total,
        (s.sold_at AT TIME ZONE business_timezone)::date AS day_date
      FROM public.sales AS s
      WHERE s.business_id = p_business_id AND s.status = 'COMPLETED'
        AND (p_from IS NULL OR s.sold_at >= p_from)
        AND (p_to IS NULL OR s.sold_at < p_to)
    ), cumulative_lines AS (
      SELECT i.id, i.sale_id, i.item_type, i.line_total, s.subtotal, s.discount,
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
      SELECT s.id, s.day_date,
        COALESCE(sum(l.line_total - l.line_discount), 0.00) AS net,
        COALESCE(sum(l.line_total - l.line_discount) FILTER (WHERE l.item_type = 'SERVICE'), 0.00) AS service_net,
        COALESCE(sum(l.line_total - l.line_discount) FILTER (WHERE l.item_type = 'PRODUCT'), 0.00) AS product_net,
        count(l.id) = 0
          OR COALESCE(sum(l.line_total), 0.00) <> s.subtotal
          OR COALESCE(sum(l.line_discount), 0.00) <> s.discount
          OR COALESCE(sum(l.line_total - l.line_discount), 0.00) <> s.total
          OR COALESCE(bool_or(l.line_discount < 0 OR l.line_discount > l.line_total), false) AS invalid
      FROM eligible_sales AS s
      LEFT JOIN allocated_lines AS l ON l.sale_id = s.id
      GROUP BY s.id, s.day_date, s.subtotal, s.discount, s.total
    ), daily AS (
      SELECT s.day_date, sum(s.service_net) AS service_net, sum(s.product_net) AS product_net, sum(s.net) AS net
      FROM per_sale AS s GROUP BY s.day_date
    ), bounds AS (
      SELECT CASE WHEN p_from IS NULL THEN min(s.day_date) ELSE first_day END AS first_date,
        CASE WHEN p_to IS NULL THEN max(s.day_date) ELSE last_day END AS last_date
      FROM eligible_sales AS s
    ), spine AS (
      SELECT b.first_date + series.day_offset AS day_date
      FROM bounds AS b
      CROSS JOIN LATERAL generate_series(0, b.last_date - b.first_date) AS series(day_offset)
    ), integrity AS (
      SELECT COALESCE(bool_or(s.invalid), false) AS invalid FROM per_sale AS s
    )
    SELECT spine.day_date, round(COALESCE(d.service_net, 0.00), 2)::text AS service_net,
      round(COALESCE(d.product_net, 0.00), 2)::text AS product_net,
      round(COALESCE(d.net, 0.00), 2)::text AS net, integrity.invalid
    FROM spine LEFT JOIN daily AS d ON d.day_date = spine.day_date
    CROSS JOIN integrity
    ORDER BY spine.day_date ASC
  LOOP
    IF bucket.invalid THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Invalid history', DETAIL = 'INVALID_HISTORY';
    END IF;
    date := bucket.day_date;
    service_revenue := bucket.service_net;
    product_revenue := bucket.product_net;
    total_revenue := bucket.net;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_revenue_by_day(uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_day(uuid,timestamptz,timestamptz)
  TO authenticated;

COMMIT;
