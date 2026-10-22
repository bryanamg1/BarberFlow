const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { query } = require('./helpers/local-postgres.cjs');
const { completeCheckoutFixture } = require('./helpers/complete-checkout-fixture.cjs');
const jsonLines = (sql) =>
  query(sql)
    .split('\n')
    .filter((x) => x.startsWith('{'))
    .map((x) => JSON.parse(x));
function execute(f, body) {
  return jsonLines(
    `BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;${body}RESET ROLE;${f.stats};ROLLBACK;`,
  );
}
const noEffects = { sales: 0, items: 0, payments: 0, debits: 0, stock: 2, appointment: 'PENDING' };

for (const state of ['PENDING', 'CONFIRMED', 'IN_PROGRESS'])
  test(`BF188 public OWNER checkout from ${state}`, () => {
    const f = completeCheckoutFixture(),
      op = randomUUID();
    const rows =
      jsonLines(`BEGIN;${f.sql}UPDATE public.appointments SET status='${state}' WHERE id='${f.appointment}';${f.identity()}
    SET LOCAL ROLE authenticated;SELECT ${f.checkout(op)};RESET ROLE;${f.stats};ROLLBACK;`);
    const [out, stats] = rows;
    assert.deepEqual(Object.keys(out).sort(), ['items', 'payments', 'sale']);
    assert.equal(Object.keys(out.sale).length, 13);
    assert.ok(out.items.every((i) => Object.keys(i).length === 11));
    assert.equal(out.sale.subtotal, 20);
    assert.equal(out.sale.total, 20);
    assert.equal(out.sale.discount, 0);
    assert.equal(out.sale.client_id, f.client);
    assert.equal(out.sale.created_by, f.owner);
    assert.equal(out.items.length, 3);
    assert.equal(Object.keys(out.payments[0]).length, 9);
    assert.deepEqual(stats, {
      sales: 1,
      items: 3,
      payments: 1,
      debits: 2,
      stock: 0,
      appointment: 'COMPLETED',
    });
  });
test('BF188 direct sale leaves appointment and snapshots intact', () => {
  const f = completeCheckoutFixture();
  const [out, stats] = execute(f, `SELECT ${f.checkout(randomUUID(), { appointmentId: null })};`);
  assert.equal(out.sale.appointment_id, null);
  assert.equal(out.sale.client_id, null);
  assert.equal(stats.appointment, 'PENDING');
  assert.equal(stats.debits, 2);
});
for (const state of ['COMPLETED', 'CANCELLED', 'NO_SHOW'])
  test(`BF188 rejects new operation for ${state} without writes`, () => {
    const f = completeCheckoutFixture();
    const rows =
      jsonLines(`BEGIN;${f.sql}UPDATE public.appointments SET status='${state}' WHERE id='${f.appointment}';${f.identity()}
    SET LOCAL ROLE authenticated;${f.expect(`PERFORM ${f.checkout(randomUUID())}`, 'PT409')}RESET ROLE;${f.stats};ROLLBACK;`);
    assert.deepEqual(rows.at(-1), { ...noEffects, appointment: state });
  });
for (const actor of ['barber', 'stranger', 'inactive', 'anonymous', 'foreign'])
  test(`BF188 ${actor} denied without side effects`, () => {
    const f = completeCheckoutFixture();
    const user =
      actor === 'barber'
        ? f.barber
        : actor === 'stranger'
          ? f.other
          : actor === 'anonymous'
            ? ''
            : f.owner;
    const setup =
      actor === 'inactive'
        ? `UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`
        : '';
    const result =
      jsonLines(`BEGIN;${f.sql}${setup}${f.identity(user)}SET LOCAL ROLE ${actor === 'anonymous' ? 'anon' : 'authenticated'};
    ${f.expect(`PERFORM ${f.checkout(randomUUID(), actor === 'foreign' ? { businessId: f.foreignBusiness } : {})}`, '42501')}
    RESET ROLE;${f.stats};ROLLBACK;`).at(-1);
    assert.deepEqual(result, noEffects);
  });
for (const method of ['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET'])
  test(`BF188 exact payment method ${method}`, () => {
    const f = completeCheckoutFixture();
    const [out] = execute(f, `SELECT ${f.checkout(randomUUID(), { method })};`);
    assert.equal(out.payments.length, 1);
    assert.equal(out.payments[0].payment_method, method);
    assert.equal(out.payments[0].amount, 20);
  });
test('BF188 free products consume stock, full discount creates no payment', () => {
  const f = completeCheckoutFixture();
  const [out, stats] = execute(f, `SELECT ${f.checkout(randomUUID(), { discount: '20.00' })};`);
  assert.equal(out.sale.total, 0);
  assert.deepEqual(out.payments, []);
  assert.equal(stats.stock, 0);
  assert.equal(stats.debits, 2);
});
test('BF188 service-only zero subtotal and null client direct sale', () => {
  const f = completeCheckoutFixture();
  const [out, stats] = execute(
    f,
    `SELECT ${f.checkout(randomUUID(), { appointmentId: null, items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1 }] })};`,
  );
  assert.equal(out.sale.subtotal, 0);
  assert.deepEqual(out.payments, []);
  assert.equal(stats.debits, 0);
  assert.equal(stats.stock, 2);
});
test('BF188 override exact decimal and global discount preserve gross line/cost snapshots', () => {
  const f = completeCheckoutFixture();
  const [out] = execute(
    f,
    `SELECT ${f.checkout(randomUUID(), { discount: '0.01', items: [{ itemType: 'PRODUCT', itemId: f.product, quantity: 2, unitPriceOverride: '0.29' }] })};`,
  );
  assert.equal(out.sale.subtotal, 0.58);
  assert.equal(out.sale.total, 0.57);
  assert.equal(out.items[0].line_total, 0.58);
  assert.equal(out.items[0].unit_cost_snapshot, 4);
  assert.equal(out.items[0].item_name_snapshot, 'Product snapshot');
});
const invalidCases = {
  'empty items': { items: [] },
  'null items': { items: null },
  'object items': { items: {} },
  'unknown key': (f) => ({
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1, created_by: f.other }],
  }),
  'invalid UUID': { items: [{ itemType: 'SERVICE', itemId: 'invalid', quantity: 1 }] },
  'zero quantity': (f) => ({ items: [{ itemType: 'PRODUCT', itemId: f.product, quantity: 0 }] }),
  'fractional quantity': (f) => ({
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1.5 }],
  }),
  'int4 overflow': (f) => ({
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 2147483648 }],
  }),
  'unknown item type': (f) => ({ items: [{ itemType: 'OTHER', itemId: f.service, quantity: 1 }] }),
  'null override': (f) => ({
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1, unitPriceOverride: null }],
  }),
  'numeric override': (f) => ({
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1, unitPriceOverride: 5 }],
  }),
  'overprecise override': (f) => ({
    items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1, unitPriceOverride: '0.001' }],
  }),
  'overflow gross': (f) => ({
    items: [
      { itemType: 'SERVICE', itemId: f.service, quantity: 2, unitPriceOverride: '9999999999.99' },
    ],
  }),
  'legacy method': { method: 'TRANSFER' },
  'null method': { method: null },
  'negative discount': { discount: '-1' },
  'NaN discount': { discount: 'NaN' },
  'infinite discount': { discount: 'Infinity' },
  'overprecise discount': { discount: '0.001' },
  'discount above subtotal': { discount: '21' },
  'unknown appointment': { appointmentId: randomUUID() },
  'unknown client': { appointmentId: null, clientId: randomUUID() },
};
for (const [name, input] of Object.entries(invalidCases))
  test(`BF188 rejects ${name} atomically and safely`, () => {
    const f = completeCheckoutFixture();
    const p = typeof input === 'function' ? input(f) : input;
    const result = execute(f, f.expect(`PERFORM ${f.checkout(randomUUID(), p)}`, '22023')).at(-1);
    assert.deepEqual(result, noEffects);
  });
test('BF188 insufficient stock is PT409 and rolls back every slice', () => {
  const f = completeCheckoutFixture();
  assert.deepEqual(
    execute(
      f,
      f.expect(
        `PERFORM ${f.checkout(randomUUID(), { items: [{ itemType: 'PRODUCT', itemId: f.product, quantity: 3 }] })}`,
        'PT409',
      ),
    ).at(-1),
    noEffects,
  );
});
test('BF188 unknown and foreign item/client/appointment uniformly fail', () => {
  const f = completeCheckoutFixture(),
    foreign = randomUUID(),
    foreignClient = randomUUID(),
    foreignAppt = randomUUID();
  query(`BEGIN;${f.sql}
    INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES('${foreign}','${f.foreignBusiness}','Foreign',10,30);
    INSERT INTO public.clients(id,business_id,first_name) VALUES('${foreignClient}','${f.foreignBusiness}','Foreign');
    INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,created_by) VALUES('${foreignAppt}','${f.foreignBusiness}','${foreignClient}','${f.ownerMember}','2026-10-14T11:00Z','2026-10-14T11:30Z','${f.owner}');
    ${f.identity()}SET LOCAL ROLE authenticated;
    ${f.expect(`PERFORM ${f.checkout(randomUUID(), { items: [{ itemType: 'SERVICE', itemId: foreign, quantity: 1 }] })}`, '22023')}
    ${f.expect(`PERFORM ${f.checkout(randomUUID(), { appointmentId: null, clientId: foreignClient })}`, '22023')}
    ${f.expect(`PERFORM ${f.checkout(randomUUID(), { appointmentId: foreignAppt })}`, '22023')}ROLLBACK;`);
});
test('BF188 replay returns original after catalog changes, stock depletion and malformed new request', () => {
  const f = completeCheckoutFixture(),
    op = randomUUID();
  const rows =
    jsonLines(`BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.checkout(op)};RESET ROLE;
    UPDATE public.products SET sale_price=900,default_purchase_cost=800,name='Changed',is_active=false WHERE id='${f.product}';
    UPDATE public.services SET name='Changed',price=100,is_active=false WHERE id='${f.service}';
    UPDATE public.businesses SET is_active=false WHERE id='${f.business}';
    SET LOCAL ROLE authenticated;SELECT ${f.checkout(op, { items: null, method: null, discount: null, appointmentId: randomUUID() })};RESET ROLE;${f.stats};ROLLBACK;`);
  assert.deepEqual(rows[0], rows[1]);
  assert.equal(rows[2].sales, 1);
  assert.equal(rows[2].debits, 2);
});
test('BF188 authorized replay of VOIDED remains VOIDED without effects', () => {
  const f = completeCheckoutFixture(),
    op = randomUUID();
  const rows =
    jsonLines(`BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.checkout(op)};RESET ROLE;
    UPDATE public.sales SET status='VOIDED' WHERE operation_id='${op}';
    SET LOCAL ROLE authenticated;SELECT ${f.checkout(op, { items: [] })};RESET ROLE;${f.stats};ROLLBACK;`);
  assert.equal(rows[1].sale.status, 'VOIDED');
  assert.deepEqual(rows[0].items, rows[1].items);
  assert.deepEqual(rows[0].payments, rows[1].payments);
  assert.equal(rows[2].debits, 2);
  assert.equal(rows[2].appointment, 'COMPLETED');
});
test('BF188 rejects partial history without repair and new operation cannot consume completed appointment', () => {
  const f = completeCheckoutFixture(),
    op = randomUUID();
  query(`BEGIN;${f.sql}${f.identity()}SELECT ${f.header(op)};
    SET LOCAL ROLE authenticated;${f.expect(`PERFORM ${f.checkout(op)}`, '22023')}RESET ROLE;ROLLBACK;`);
  const stats = execute(
    f,
    `SELECT ${f.checkout(randomUUID())};${f.expect(`PERFORM ${f.checkout(randomUUID())}`, 'PT409')}`,
  ).at(-1);
  assert.equal(stats.sales, 1);
  assert.equal(stats.debits, 2);
});
for (const stage of ['sales', 'sale_items', 'payments', 'stock_movements', 'appointments'])
  test(`BF188 forced failure after ${stage} rolls back entire public call`, () => {
    const f = completeCheckoutFixture();
    const event = stage === 'appointments' ? 'UPDATE' : 'INSERT';
    const when =
      stage === 'appointments'
        ? "WHEN (NEW.status='COMPLETED')"
        : stage === 'stock_movements'
          ? "WHEN (NEW.type='SALE')"
          : '';
    const stats = jsonLines(`BEGIN;${f.sql}
    CREATE FUNCTION pg_temp.fail188() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='ZT188',MESSAGE='Controlled test failure'; END $$;
    CREATE TRIGGER bf188_failure AFTER ${event} ON public.${stage} FOR EACH ROW ${when} EXECUTE FUNCTION pg_temp.fail188();
    ${f.identity()}SET LOCAL ROLE authenticated;${f.expect(`PERFORM ${f.checkout(randomUUID())}`, 'ZT188')}RESET ROLE;${f.stats};ROLLBACK;`).at(
      -1,
    );
    assert.deepEqual(stats, noEffects);
  });
test('BF188 final result failure also rolls back completion and every financial/stock row', () => {
  const f = completeCheckoutFixture();
  const stats = jsonLines(`BEGIN;${f.sql}
    ALTER FUNCTION private.get_checkout_replay(uuid,uuid) RENAME TO original_replay188;
    CREATE FUNCTION private.get_checkout_replay(p_business_id uuid,p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
    DECLARE v jsonb; BEGIN v:=private.original_replay188(p_business_id,p_operation_id);IF v IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='ZT188',MESSAGE='Controlled result failure';END IF;RETURN v;END $$;
    ${f.identity()}SET LOCAL ROLE authenticated;${f.expect(`PERFORM ${f.checkout(randomUUID())}`, 'ZT188')}RESET ROLE;${f.stats};ROLLBACK;`).at(
    -1,
  );
  assert.deepEqual(stats, noEffects);
});

for (const actor of ['barber', 'inactive', 'foreign'])
  test(`BF188 ${actor} denied on historical replay`, () => {
    const f = completeCheckoutFixture(),
      op = randomUUID();
    const setup =
      actor === 'inactive'
        ? `UPDATE public.business_members SET is_active=false WHERE id='${f.ownerMember}';`
        : '';
    const rows =
      jsonLines(`BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.checkout(op)};RESET ROLE;
    ${setup}${f.identity(actor === 'barber' ? f.barber : f.owner)}SET LOCAL ROLE authenticated;
    ${f.expect(`PERFORM ${f.checkout(op, actor === 'foreign' ? { businessId: f.foreignBusiness } : {})}`, '42501')}RESET ROLE;${f.stats};ROLLBACK;`);
    assert.equal(rows.at(-1).sales, 1);
    assert.equal(rows.at(-1).debits, 2);
  });
test('BF188 another active OWNER replays original actor, no business-active gate on new checkout', () => {
  const f = completeCheckoutFixture(),
    op = randomUUID();
  const rows =
    jsonLines(`BEGIN;${f.sql}UPDATE public.businesses SET is_active=false WHERE id='${f.business}';
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${f.business}','${f.other}','OWNER');
    ${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.checkout(op)};${f.identity(f.other)}SELECT ${f.checkout(op, { items: [] })};ROLLBACK;`);
  assert.deepEqual(rows[0], rows[1]);
  assert.equal(rows[1].sale.created_by, f.owner);
});
for (const kind of ['PRODUCT', 'SERVICE'])
  test(`BF188 inactive ${kind} cannot be sold on new operation`, () => {
    const f = completeCheckoutFixture();
    const table = kind === 'PRODUCT' ? 'products' : 'services',
      id = kind === 'PRODUCT' ? f.product : f.service;
    const rows =
      jsonLines(`BEGIN;${f.sql}UPDATE public.${table} SET is_active=false WHERE id='${id}';${f.identity()}SET LOCAL ROLE authenticated;
    ${f.expect(`PERFORM ${f.checkout(randomUUID())}`, '22023')}RESET ROLE;${f.stats};ROLLBACK;`);
    assert.deepEqual(rows.at(-1), noEffects);
  });
test('BF188 explicit client must match linked appointment and snapshots stay unchanged', () => {
  const f = completeCheckoutFixture(),
    otherClient = randomUUID();
  const rows =
    jsonLines(`BEGIN;${f.sql}INSERT INTO public.clients(id,business_id,first_name) VALUES('${otherClient}','${f.business}','Other');
    CREATE TEMP TABLE history188 AS SELECT jsonb_agg(to_jsonb(i) ORDER BY id) history FROM public.appointment_services i WHERE appointment_id='${f.appointment}';
    ${f.identity()}SET LOCAL ROLE authenticated;
    ${f.expect(`PERFORM ${f.checkout(randomUUID(), { clientId: otherClient })}`, '22023')}
    SELECT ${f.checkout(randomUUID(), { clientId: f.client })};RESET ROLE;
    DO $$ BEGIN IF (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.appointment_services i WHERE appointment_id='${f.appointment}') IS DISTINCT FROM (SELECT history FROM history188) THEN RAISE EXCEPTION 'Changed appointment history';END IF;END $$;
    ${f.stats};ROLLBACK;`);
  assert.equal(rows[0].sale.client_id, f.client);
  assert.equal(rows.at(-1).sales, 1);
});
test('BF188 NULL operation rejected and malformed item UUID exposes only fixed safe error', () => {
  const f = completeCheckoutFixture();
  const bad = f.checkout(randomUUID(), {
    items: [{ itemType: 'SERVICE', itemId: 'private-sensitive-input', quantity: 1 }],
  });
  assert.deepEqual(
    execute(
      f,
      `${f.expect(`PERFORM ${f.checkout(null)}`, '22023')}
    DO $$ DECLARE msg text; detail text; BEGIN BEGIN PERFORM ${bad};RAISE EXCEPTION 'Missing failure';
      EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL;
      IF msg<>'Invalid checkout' OR detail<>'INVALID_CHECKOUT' THEN RAISE EXCEPTION 'Unsafe error';END IF;END;END $$;`,
    ).at(-1),
    noEffects,
  );
});
test('BF188 maximum monetary amount stays exact and service cost remains NULL', () => {
  const f = completeCheckoutFixture();
  const [out] = execute(
    f,
    `SELECT ${f.checkout(randomUUID(), { items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1, unitPriceOverride: '9999999999.99' }] })};`,
  );
  assert.equal(out.sale.total, 9999999999.99);
  assert.equal(out.payments[0].amount, 9999999999.99);
  assert.equal(out.items[0].unit_cost_snapshot, null);
});
