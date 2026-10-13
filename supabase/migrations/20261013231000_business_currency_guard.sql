BEGIN;

-- Trigger-only functions live outside the exposed API schemas. No new client privilege.
CREATE FUNCTION private.guard_business_currency_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.currency_code IS NOT DISTINCT FROM OLD.currency_code THEN
    RETURN NEW;
  END IF;

  -- A transaction-wide old snapshot cannot safely prove the absence of new history.
  -- The API uses READ COMMITTED. Other isolation levels must retry this mutation there.
  IF pg_catalog.current_setting('transaction_isolation') NOT IN ('read committed', 'read uncommitted') THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'No se pudo actualizar la moneda. Reintenta la operación.';
  END IF;

  -- The UPDATE already owns this business row lock. Financial writers take the same
  -- lock before creating/moving history; VOLATILE gives this check a fresh snapshot.
  IF EXISTS (SELECT 1 FROM public.sales WHERE business_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.payments WHERE business_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.purchases WHERE business_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.expenses WHERE business_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0272', MESSAGE = 'La moneda no puede cambiar después de registrar actividad financiera.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.lock_financial_business_currency()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM id FROM public.businesses WHERE id = NEW.business_id FOR NO KEY UPDATE;
  ELSIF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    -- Stable order for a move between two businesses; this does not authorize it.
    PERFORM id FROM public.businesses
      WHERE id IN (OLD.business_id, NEW.business_id)
      ORDER BY id FOR NO KEY UPDATE;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_business_currency_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lock_financial_business_currency() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER businesses_guard_currency
BEFORE UPDATE OF currency_code ON public.businesses
FOR EACH ROW EXECUTE FUNCTION private.guard_business_currency_change();

CREATE TRIGGER sales_lock_business_currency
BEFORE INSERT OR UPDATE OF business_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION private.lock_financial_business_currency();
CREATE TRIGGER payments_lock_business_currency
BEFORE INSERT OR UPDATE OF business_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION private.lock_financial_business_currency();
CREATE TRIGGER purchases_lock_business_currency
BEFORE INSERT OR UPDATE OF business_id ON public.purchases
FOR EACH ROW EXECUTE FUNCTION private.lock_financial_business_currency();
CREATE TRIGGER expenses_lock_business_currency
BEFORE INSERT OR UPDATE OF business_id ON public.expenses
FOR EACH ROW EXECUTE FUNCTION private.lock_financial_business_currency();

COMMIT;
