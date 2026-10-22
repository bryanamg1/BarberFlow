const { replayFixture } = require('./checkout-replay-fixture.cjs');
const literal = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);
function completeCheckoutFixture() {
  const f = replayFixture();
  const defaults = {
    businessId: f.business,
    appointmentId: f.appointment,
    clientId: null,
    discount: '0.00',
    method: 'CASH',
    items: [
      { itemType: 'PRODUCT', itemId: f.product, quantity: 1 },
      { itemType: 'PRODUCT', itemId: f.product, quantity: 1 },
      { itemType: 'SERVICE', itemId: f.service, quantity: 1 },
    ],
  };
  const checkout = (op, options = {}) => {
    const p = { ...defaults, ...options };
    const discount = p.discount === null ? 'NULL' : `${literal(p.discount)}::numeric`;
    return `public.complete_checkout(${literal(p.businessId)},${literal(op)},${literal(p.appointmentId)},${literal(p.clientId)},${discount},${literal(p.method)},${literal(JSON.stringify(p.items))}::jsonb)`;
  };
  const stats = `SELECT jsonb_build_object(
    'sales',(SELECT count(*) FROM public.sales WHERE business_id='${f.business}'),
    'items',(SELECT count(*) FROM public.sale_items WHERE sale_id IN (SELECT id FROM public.sales WHERE business_id='${f.business}')),
    'payments',(SELECT count(*) FROM public.payments WHERE business_id='${f.business}'),
    'debits',(SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}' AND type='SALE'),
    'stock',(SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${f.product}'),
    'appointment',(SELECT status FROM public.appointments WHERE id='${f.appointment}'))`;
  return { ...f, checkout, stats, defaults, literal };
}
module.exports = { completeCheckoutFixture };
