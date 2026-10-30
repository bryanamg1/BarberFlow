const { randomUUID } = require('node:crypto');
const { completeCheckoutFixture } = require('./complete-checkout-fixture.cjs');

function saleVoidFixture() {
  const f = completeCheckoutFixture();
  const operation = randomUUID();
  const saleId = "((SELECT outcome FROM original)->'sale'->>'id')::uuid";
  const voidSale = (
    op = operation,
    reason = '  Original reason  ',
    business = f.business,
    target = saleId,
  ) => `public.void_sale(${f.literal(business)},${f.literal(op)},${target},${f.literal(reason)})`;
  const reader = (business = f.business, target = saleId) =>
    `public.get_sale_correction_detail(${f.literal(business)},${target})`;
  const setup = (options = {}) => `${f.sql}${f.identity()}SET LOCAL ROLE authenticated;
    CREATE TEMP TABLE original AS SELECT ${f.checkout(randomUUID(), options)} AS outcome;
    RESET ROLE;`;
  const expect = (expression, code, detail = null) => `DO $expect$ DECLARE c text;d text;BEGIN
    BEGIN PERFORM ${expression};EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS c=RETURNED_SQLSTATE,d=PG_EXCEPTION_DETAIL;END;
    IF c IS DISTINCT FROM '${code}' ${detail ? `OR d IS DISTINCT FROM '${detail}'` : ''}
      THEN RAISE EXCEPTION 'Expected ${code}/${detail}, got %/%',c,d;END IF;END $expect$;`;
  const history = `jsonb_build_object(
    'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s WHERE business_id='${f.business}'),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${f.business}'),
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payments p WHERE business_id='${f.business}'),
    'ledger',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE business_id='${f.business}'),
    'audit',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM private.sale_voids v WHERE business_id='${f.business}'),
    'appointment',(SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}'))`;
  return { ...f, operation, saleId, voidSale, reader, setup, expect, history };
}
module.exports = { saleVoidFixture };
