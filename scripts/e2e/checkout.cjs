const assert = require('node:assert/strict');
const local = require('./local.cjs');
const { guard } = require('../../tests/e2e/helpers/environment.cjs');

function fixture(key = 'a') {
  assert.ok(['a', 'b'].includes(key));
  return {
    serviceId: local.id(`bf306-service-${key}`),
    productId: local.id(`bf306-product-${key}`),
    movementId: local.id(`bf306-opening-stock-${key}`),
    appointmentId: local.id(`bf306-appointment-${key}`),
    appointmentItemId: local.id(`bf306-appointment-item-${key}`),
    serviceName: `BF306 Service ${key.toUpperCase()}`,
    productName: `BF306 Product ${key.toUpperCase()}`,
  };
}

function seed(users, { servicePrice = '15.01' } = {}) {
  guard();
  assert.ok(['15.01', '10.02'].includes(servicePrice));
  for (const key of ['a', 'b']) {
    const user = users[key],
      f = fixture(key);
    // Never accept arbitrary account IDs or SQL identifiers from callers.
    assert.equal(user.userId, local.id(`owner-${key}`));
    assert.equal(user.businessId, local.id(`tenant-${key}`));
    assert.equal(user.memberId, local.id(`membership-${key}`));
    assert.equal(user.clientId, local.id(`client-${key}`));
    local.sql(`BEGIN;
      INSERT INTO public.services(id,business_id,name,price,duration_minutes)
        VALUES('${f.serviceId}','${user.businessId}','${f.serviceName}',${servicePrice},30);
      INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,minimum_stock)
        VALUES('${f.productId}','${user.businessId}','${f.productName}',10.02,4.03,1);
      INSERT INTO public.stock_movements(id,business_id,product_id,type,quantity_delta,created_by,occurred_at)
        VALUES('${f.movementId}','${user.businessId}','${f.productId}','ADJUSTMENT',20,'${user.userId}','2026-01-01T00:00:00Z');
      INSERT INTO public.business_settings(business_id) VALUES('${user.businessId}');
      INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by)
        VALUES('${f.appointmentId}','${user.businessId}','${user.clientId}','${user.memberId}',
          '2026-11-05T09:00:00Z','2026-11-05T09:30:00Z','CONFIRMED','${user.userId}');
      INSERT INTO public.appointment_services(id,appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total)
        VALUES('${f.appointmentItemId}','${f.appointmentId}','${f.serviceId}','BF306 Historical service',12.00,30,1,12.00);
      COMMIT;`);
  }
  assert.equal(local.sql('SELECT count(*) FROM public.sales'), '0');
  assert.equal(local.sql('SELECT count(*) FROM auth.sessions'), '0');
  for (const key of ['a', 'b']) assert.equal(stock(key), '20');
}

function reset(users, options) {
  local.fullReset();
  local.seed(users);
  seed(users, options);
}

function stock(key = 'a') {
  const f = fixture(key);
  return local.sql(
    `SELECT COALESCE(sum(quantity_delta),0)::text FROM public.stock_movements WHERE product_id='${f.productId}'`,
  );
}

function snapshot(key = 'a') {
  const businessId = local.id(`tenant-${key}`),
    f = fixture(key);
  // Money crosses the test boundary as decimal text, never as floating point.
  return JSON.parse(
    local.sql(`SELECT jsonb_build_object(
    'sales',COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('subtotal',s.subtotal::text,'discount',s.discount::text,'total',s.total::text) ORDER BY s.id) FROM public.sales s WHERE business_id='${businessId}'),'[]'),
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('unit_price_snapshot',i.unit_price_snapshot::text,'unit_cost_snapshot',i.unit_cost_snapshot::text,'line_total',i.line_total::text) ORDER BY i.id) FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE s.business_id='${businessId}'),'[]'),
    'payments',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('amount',p.amount::text) ORDER BY p.id) FROM public.payments p WHERE business_id='${businessId}'),'[]'),
    'movements',COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('unit_cost',m.unit_cost::text) ORDER BY m.id) FROM public.stock_movements m WHERE business_id='${businessId}'),'[]'),
    'appointment',(SELECT to_jsonb(a) FROM public.appointments a WHERE id='${f.appointmentId}'),
    'appointmentItems',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.appointment_services i WHERE appointment_id='${f.appointmentId}')
  )`),
  );
}

function cents(value) {
  assert.match(value, /^\d+\.\d{2}$/);
  return BigInt(value.replace('.', ''));
}

function verify(actual, expected) {
  const { sales, items, payments, movements } = actual;
  assert.equal(sales.length, 1, 'Exactly one sale must persist');
  const sale = sales[0];
  assert.equal(sale.status, 'COMPLETED');
  assert.ok(sale.sold_at && sale.created_at && sale.updated_at);
  assert.equal(sale.business_id, local.id('tenant-a'));
  assert.equal(sale.created_by, local.id('owner-a'));
  assert.equal(sale.client_id, expected.linked ? local.id('client-a') : null);
  assert.equal(sale.appointment_id, expected.linked ? fixture().appointmentId : null);
  assert.equal(sale.subtotal, expected.gross);
  assert.equal(sale.discount, expected.discount || '0.00');
  assert.equal(sale.total, expected.net);
  assert.equal(items.length, expected.items.length);
  for (const wanted of expected.items) {
    const item = items.find((row) => row.item_type === wanted.type);
    assert.ok(item);
    assert.equal(item.sale_id, sale.id);
    assert.equal(item.quantity, wanted.quantity);
    assert.equal(item.unit_price_snapshot, wanted.price);
    assert.equal(cents(item.line_total), cents(wanted.price) * BigInt(wanted.quantity));
    assert.equal(
      item.item_name_snapshot,
      wanted.type === 'PRODUCT' ? fixture().productName : fixture().serviceName,
    );
    assert.equal(item.unit_cost_snapshot, wanted.type === 'PRODUCT' ? '4.03' : null);
    assert.equal(item.product_id, wanted.type === 'PRODUCT' ? fixture().productId : null);
    assert.equal(item.service_id, wanted.type === 'SERVICE' ? fixture().serviceId : null);
  }
  assert.equal(payments.length, expected.net === '0.00' ? 0 : 1);
  for (const payment of payments) {
    assert.equal(payment.sale_id, sale.id);
    assert.equal(payment.business_id, sale.business_id);
    assert.equal(payment.amount, expected.net);
    assert.equal(payment.payment_method, expected.method || 'CASH');
    assert.equal(payment.created_by, sale.created_by);
    assert.ok(payment.paid_at);
  }
  const original = movements.find((m) => m.id === fixture().movementId);
  assert.ok(original);
  assert.equal(original.type, 'ADJUSTMENT');
  assert.equal(original.quantity_delta, 20);
  assert.equal(original.occurred_at, '2026-01-01T00:00:00+00:00');
  const product = expected.items.find((item) => item.type === 'PRODUCT');
  assert.equal(movements.length, product ? 2 : 1);
  const debits = movements.filter((m) => m.type === 'SALE');
  assert.equal(debits.length, product ? 1 : 0);
  if (product) {
    assert.equal(debits[0].quantity_delta, -product.quantity);
    assert.equal(debits[0].unit_cost, '4.03');
    assert.equal(debits[0].reference_id, sale.id);
    assert.equal(debits[0].product_id, fixture().productId);
  }
  assert.equal(
    movements.reduce((sum, m) => sum + m.quantity_delta, 0),
    20 - (product?.quantity || 0),
  );
  assert.equal(actual.appointment.status, expected.linked ? 'COMPLETED' : 'CONFIRMED');
  assert.equal(actual.appointmentItems[0].service_name_snapshot, 'BF306 Historical service');
  assert.equal(actual.appointmentItems[0].unit_price_snapshot, 12);
  return sale.id;
}

function demote() {
  local.sql(
    `UPDATE public.business_members SET role='BARBER' WHERE id='${local.id('membership-a')}'`,
  );
}
function deactivateService() {
  local.sql(`UPDATE public.services SET is_active=false WHERE id='${fixture().serviceId}'`);
}

module.exports = {
  fixture,
  seed,
  reset,
  stock,
  snapshot,
  cents,
  verify,
  demote,
  deactivateService,
};
