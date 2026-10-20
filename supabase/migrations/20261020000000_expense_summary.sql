-- BF-242: effective expenses only; historical rows and all writers are unchanged.
BEGIN;

CREATE FUNCTION public.get_expense_summary(
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
  business_timezone text;
  from_date date;
  to_date date;
  summary jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXPENSE_ACCESS_DENIED';
  END IF;

  -- ALL_TIME is the null pair. Otherwise endpoints are finite instants, with
  -- an exclusive upper bound. Equal bounds represent an empty interval.
  IF (p_from IS NULL) <> (p_to IS NULL)
     OR (p_from IS NOT NULL AND
       (NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from > p_to)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_INPUT';
  END IF;
  SELECT b.timezone INTO business_timezone
    FROM public.businesses AS b WHERE b.id = p_business_id;
  IF business_timezone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'EXPENSE_ACCESS_DENIED';
  END IF;
  -- Expenses are civil dates, never timestamps. Convert both range endpoints
  -- in the business timezone, not the session/client timezone or a fixed offset.
  from_date := (p_from AT TIME ZONE business_timezone)::date;
  to_date := (p_to AT TIME ZONE business_timezone)::date;

  WITH eligible AS (
    SELECT e.category_id, e.source_type, e.amount
    FROM public.expenses AS e
    JOIN public.expense_categories AS category
      ON category.id = e.category_id AND category.business_id = e.business_id
    LEFT JOIN public.purchases AS purchase
      ON purchase.id = e.purchase_id AND purchase.business_id = e.business_id
    WHERE e.business_id = p_business_id
      AND (from_date IS NULL OR e.expense_date >= from_date)
      AND (to_date IS NULL OR e.expense_date < to_date)
      AND (e.source_type = 'MANUAL'
        OR (e.source_type = 'PURCHASE' AND purchase.id IS NOT NULL
          AND purchase.status <> 'VOIDED'))
  ), totals AS (
    SELECT
      COALESCE(sum(e.amount) FILTER (WHERE e.source_type = 'MANUAL'), 0.00) AS manual_total,
      COALESCE(sum(e.amount) FILTER (WHERE e.source_type = 'PURCHASE'), 0.00) AS purchase_total,
      COALESCE(sum(e.amount), 0.00) AS total
    FROM eligible AS e
  ), categories AS (
    SELECT e.category_id, sum(e.amount) AS amount
    FROM eligible AS e GROUP BY e.category_id
  )
  SELECT jsonb_build_object(
    'manual_total', totals.manual_total::text,
    'purchase_total', totals.purchase_total::text,
    'total', totals.total::text,
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id', categories.category_id,
        'amount', categories.amount::text
      ) ORDER BY categories.category_id)
      FROM categories
    ), '[]'::jsonb)
  ) INTO summary FROM totals;
  RETURN summary;
END;
$$;

REVOKE ALL ON FUNCTION public.get_expense_summary(uuid,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_expense_summary(uuid,timestamptz,timestamptz)
  TO authenticated;

COMMIT;
