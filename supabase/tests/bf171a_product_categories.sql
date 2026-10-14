BEGIN;

-- Isolated synthetic fixtures. Nothing survives this transaction.
INSERT INTO auth.users (id) VALUES ('00000000-171a-4000-8000-000000000001');
INSERT INTO public.businesses (id, name)
VALUES ('00000000-171a-4000-8000-000000000002', 'BF171A categories');
INSERT INTO public.business_members (business_id, user_id, role)
VALUES ('00000000-171a-4000-8000-000000000002', '00000000-171a-4000-8000-000000000001', 'OWNER');
INSERT INTO public.product_categories (id, business_id, name) VALUES
('00000000-171a-4000-8000-000000000003', '00000000-171a-4000-8000-000000000002', ' Duplicate '),
('00000000-171a-4000-8000-000000000004', '00000000-171a-4000-8000-000000000002', ' Duplicate ');
INSERT INTO public.products (id,business_id,category_id,name,sale_price,default_purchase_cost)
VALUES ('00000000-171a-4000-8000-000000000005', '00000000-171a-4000-8000-000000000002',
  '00000000-171a-4000-8000-000000000003', 'Referenced product', 10, 4);
CREATE TEMP TABLE bf171a_before AS SELECT * FROM public.products;
GRANT SELECT ON bf171a_before TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-171a-4000-8000-000000000001","role":"authenticated"}', true);
DO $$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM public.product_categories WHERE business_id='00000000-171a-4000-8000-000000000002' AND name=' Duplicate ') <> 2 THEN
    RAISE EXCEPTION 'Duplicate category names must remain permitted';
  END IF;
  UPDATE public.product_categories SET is_active=false WHERE id='00000000-171a-4000-8000-000000000003';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'Owner archive failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_categories WHERE id='00000000-171a-4000-8000-000000000003' AND NOT is_active) THEN
    RAISE EXCEPTION 'Archived category remains readable';
  END IF;
  IF EXISTS ((SELECT * FROM public.products WHERE id='00000000-171a-4000-8000-000000000005')
    EXCEPT (SELECT * FROM bf171a_before WHERE id='00000000-171a-4000-8000-000000000005')) THEN
    RAISE EXCEPTION 'Archive modified the referenced product';
  END IF;
  UPDATE public.product_categories SET is_active=true WHERE id='00000000-171a-4000-8000-000000000003';
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id='00000000-171a-4000-8000-000000000005' AND category_id='00000000-171a-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'Category reference was lost';
  END IF;
  RAISE NOTICE 'BF171A duplicate/default/archive/restore/product-preservation checks PASS';
END;
$$;
RESET ROLE;
ROLLBACK;
