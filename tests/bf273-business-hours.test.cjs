/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src/features/business');
function load(relative, overrides = {}) {
  const file = path.resolve(root, relative + '.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'), name);
      return load(path.relative(root, path.resolve(path.dirname(file), name)), overrides);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const schemas = load('schemas/businessHours.schema');
const week = Array.from({ length: 7 }, (_, day_of_week) => ({
  day_of_week,
  open_time: '09:00:00.123456',
  close_time: '18:00:00.123456',
  is_closed: day_of_week === 0,
}));
const rows = week.map((day) => ({ ...day, id: 'id-' + day.day_of_week, business_id: 'b' }));
test('BF273 seven distinct weekdays, no trim/timezone conversion; closed times retained', () => {
  assert.deepEqual(schemas.businessHoursInputSchema.parse(week), week);
  assert.deepEqual(
    schemas.businessHourInputSchema.parse({
      ...week[0],
      open_time: '18:00',
      close_time: '09:00',
      id: 'hidden',
    }),
    { ...week[0], open_time: '18:00', close_time: '09:00' },
  );
});
for (const time of ['00:00', '09:30:01', '23:59:59.999999', '24:00', '24:00:00.000000'])
  test(`BF273 civil boundary ${time}`, () => {
    assert.equal(schemas.civilTimeSchema.parse(time), time);
  });
for (const time of [
  '',
  ' 09:00 ',
  '09:00Z',
  '09:00+03:00',
  '25:00',
  '24:00:00.000001',
  '09:60',
  '09:00:60',
  '09:00:00.1234567',
])
  test(`BF273 invalid civil time ${time}`, () => {
    assert.equal(schemas.civilTimeSchema.safeParse(time).success, false);
  });
test('BF273 open requires increasing time, including microseconds; no overnight', () => {
  for (const close_time of ['08:00', '09:00:00.123456'])
    assert.equal(
      schemas.businessHourInputSchema.safeParse({ ...week[1], close_time }).success,
      false,
    );
  assert.equal(
    schemas.businessHourInputSchema.safeParse({ ...week[1], close_time: '09:00:00.123457' })
      .success,
    true,
  );
});
for (const input of [
  [],
  week.slice(1),
  [...week, week[0]],
  [...week.slice(0, 6), week[0]],
  [{ ...week[0], day_of_week: 7 }, ...week.slice(1)],
  [{ ...week[0], is_closed: 'false' }, ...week.slice(1)],
])
  test('BF273 rejects malformed/incomplete week ' + JSON.stringify(input[0]?.day_of_week), () => {
    assert.equal(schemas.businessHoursInputSchema.safeParse(input).success, false);
  });
function service(result) {
  const calls = [];
  return {
    calls,
    ...load('services/businessHoursService', {
      '@/lib/supabase/client': { supabase: {} },
      '../repositories/businessHoursRepository': {
        businessHoursRepository: {
          getByBusinessId: (...args) => {
            calls.push(['get', ...args]);
            return Promise.resolve(result);
          },
          upsert: (...args) => {
            calls.push(['upsert', ...args]);
            return Promise.resolve(result);
          },
        },
      },
    }),
  };
}
test('BF273 empty and missing days remain truthful; no invented defaults', async () => {
  assert.deepEqual(
    await service({ data: [], error: null, status: 200 }).businessHoursService.get('b'),
    { data: [], error: null },
  );
  assert.deepEqual(
    (
      await service({ data: rows.slice(0, 2), error: null, status: 200 }).businessHoursService.get(
        'b',
      )
    ).data,
    rows.slice(0, 2),
  );
});
test('BF273 validates full week before write; uses explicit tenant and strips hidden fields', async () => {
  const h = service({ data: rows, error: null, status: 200 });
  assert.equal((await h.businessHoursService.save('b', [])).error.code, 'INVALID_SETTINGS');
  assert.equal(h.calls.length, 0);
  assert.deepEqual((await h.businessHoursService.save('b', rows)).data, rows);
  assert.deepEqual(h.calls, [['upsert', 'b', week]]);
});
test('BF273 malformed/mismatched reads are safe errors, not partial settings', async () => {
  for (const data of [
    [{ ...rows[0], business_id: 'other' }],
    [{ ...rows[0], close_time: null }],
    [rows[0], rows[0]],
    null,
  ]) {
    const r = await service({ data, error: null, status: 200 }).businessHoursService.get('b');
    assert.equal(r.data, null);
    assert(r.error);
  }
});
test('BF273 RPC error remains normalized without SQL details', async () => {
  const r = await service({
    data: null,
    error: { code: '42501', message: 'private SQL' },
    status: 403,
  }).businessHoursService.save('b', week);
  assert.equal(r.error.code, 'BUSINESS_ACCESS_DENIED');
  assert(!JSON.stringify(r).includes('private'));
});
test('BF273 real SDK sends one invoker RPC request, exact projection and no editable tenant', async () => {
  const requests = [];
  const client = createClient('https://synthetic.supabase.co', 'public-test', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, options) => {
        requests.push({ url: new URL(input), options });
        return new Response(JSON.stringify(rows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  try {
    const repository = load('repositories/businessHoursRepository', {
      '@/lib/supabase/client': { supabase: client },
    }).businessHoursRepository;
    assert.deepEqual(
      (
        await repository.upsert(
          'b',
          rows.map((row) => ({ ...row, business_id: 'foreign', updated_at: 'hidden' })),
        )
      ).data,
      rows,
    );
    assert.equal(requests.length, 1);
    const { url, options } = requests[0];
    assert.equal(options.method, 'POST');
    assert.equal(url.pathname, '/rest/v1/rpc/save_business_hours');
    // The approved RPC's RETURNS TABLE fixes its six-field wire projection.
    assert.equal(url.searchParams.has('select'), false);
    assert.equal(url.searchParams.get('order'), 'day_of_week.asc');
    assert.deepEqual(JSON.parse(options.body), { p_business_id: 'b', p_days: week });
  } finally {
    client.auth.stopAutoRefresh();
  }
});
