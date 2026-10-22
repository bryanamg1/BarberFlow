const { randomUUID } = require('node:crypto');
const { checkoutFixture } = require('./checkout-appointment-fixture.cjs');

function replayFixture() {
  const f = checkoutFixture();
  const product = randomUUID();
  const gate = (op, business = f.business) => `private.get_checkout_replay('${business}','${op}')`;
  const header = (op) =>
    `private.persist_checkout_sale('${f.business}','${op}','${f.appointment}',NULL,20,0,20)`;
  const items = JSON.stringify([
    { itemType: 'PRODUCT', itemId: product, quantity: 1 },
    { itemType: 'PRODUCT', itemId: product, quantity: 1 },
    { itemType: 'SERVICE', itemId: f.service, quantity: 1 },
  ]);
  const remaining = (
    op,
  ) => `PERFORM private.lock_checkout_products('${f.business}',ARRAY['${product}'::uuid],ARRAY[2]);
    PERFORM private.persist_checkout_items('${f.business}','${op}','${items}');
    PERFORM private.persist_checkout_payment('${f.business}','${op}','CASH');
    PERFORM private.persist_checkout_stock('${f.business}','${op}');
    PERFORM ${f.completion(op)};`;
  // Trusted local test composition only. No public orchestrator is installed.
  const pipeline = (op) => `DO $$ BEGIN IF ${gate(op)} IS NULL THEN
    PERFORM ${header(op)}; ${remaining(op)} END IF; END $$;`;
  const snapshot = (op) => `SELECT jsonb_build_object(
    'outcome',${gate(op)},
    'appointment',(SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointment}'),
    'appointmentItems',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.appointment_services i WHERE appointment_id='${f.appointment}'),
    'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.stock_movements m WHERE business_id='${f.business}'),
    'sales',(SELECT count(*) FROM public.sales WHERE business_id='${f.business}'));
  `;
  return {
    ...f,
    product,
    gate,
    header,
    remaining,
    pipeline,
    snapshot,
    sql: `${f.sql}
      INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
        VALUES('${product}','${f.business}','Product snapshot',10,4);
      INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by)
        VALUES('${f.business}','${product}','ADJUSTMENT',2,'${f.owner}');`,
  };
}
module.exports = { replayFixture };
