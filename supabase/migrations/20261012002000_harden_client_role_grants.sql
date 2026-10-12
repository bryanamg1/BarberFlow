BEGIN;

-- BF-116A: these 19 postgres-owned tables are authenticated business data.
-- Schema USAGE stays intact; authorization remains in the existing 46 policies.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.profiles, public.businesses, public.business_members,
    public.business_settings, public.business_hours, public.clients,
    public.services, public.appointments, public.appointment_services,
    public.product_categories, public.products, public.sales, public.sale_items,
    public.payments, public.purchases, public.purchase_items,
    public.stock_movements, public.expense_categories, public.expenses
  FROM anon;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.profiles, public.businesses, public.business_members,
    public.business_settings, public.business_hours, public.clients,
    public.services, public.appointments, public.appointment_services,
    public.product_categories, public.products, public.sales, public.sale_items,
    public.payments, public.purchases, public.purchase_items,
    public.stock_movements, public.expense_categories, public.expenses
  FROM authenticated;

-- Only business_hours and appointment_services have approved DELETE policies.
REVOKE DELETE
  ON TABLE public.profiles, public.businesses, public.business_members,
    public.business_settings, public.clients, public.services,
    public.appointments, public.product_categories, public.products,
    public.sales, public.sale_items, public.payments, public.purchases,
    public.purchase_items, public.stock_movements, public.expense_categories,
    public.expenses
  FROM authenticated;

-- Business bootstrap and transactional commerce/ledger writes are server-side.
REVOKE INSERT ON TABLE public.businesses, public.sales, public.sale_items,
  public.payments, public.purchases, public.purchase_items, public.stock_movements
  FROM authenticated;
REVOKE UPDATE ON TABLE public.sales, public.sale_items, public.payments,
  public.purchases, public.purchase_items, public.stock_movements
  FROM authenticated;

-- Never revoke/regrant UPDATE on the existing column-scoped editable tables:
-- their tenant/audit column exclusions are intentional and remain unchanged.
-- Trigger invocation does not require callers to execute the trigger function.
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Catalog inspection confirms postgres creates all V1 tables; there are no
-- public sequences. Stop automatic client grants on its future public tables
-- and sequences. Future migrations must grant their approved DML explicitly.
-- Do not change other owners/schemas, function defaults or service_role grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM anon, authenticated;

COMMIT;
