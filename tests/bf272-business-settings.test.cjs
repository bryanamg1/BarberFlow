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
const schemas = load('schemas/businessSettings.schema');
const profile = {
  id: 'b',
  name: '',
  phone: null,
  email: null,
  address: null,
  currency_code: 'ARS',
  timezone: 'UTC',
};
const preferences = {
  business_id: 'b',
  appointment_interval_minutes: 30,
  default_service_buffer_minutes: 0,
  allow_overlapping_appointments: false,
  low_stock_notifications: true,
};
test('BF272 profile preserves permitted strings/null without invented contact/name rules', () => {
  assert.deepEqual(
    schemas.businessProfileSchema.parse({
      ...profile,
      phone: '',
      email: 'not-normalized',
      address: ' A ',
    }),
    {
      name: '',
      phone: '',
      email: 'not-normalized',
      address: ' A ',
      currency_code: 'ARS',
      timezone: 'UTC',
    },
  );
  assert.deepEqual(
    schemas.updateBusinessProfileSchema.parse({
      phone: null,
      name: '  X  ',
      is_active: false,
      logo_path: 'x',
      id: 'other',
    }),
    { name: '  X  ', phone: null },
  );
});
for (const timezone of ['UTC', 'America/Argentina/Buenos_Aires', 'America/New_York'])
  test(`BF272 valid IANA ${timezone}`, () => {
    assert.equal(schemas.updateBusinessProfileSchema.parse({ timezone }).timezone, timezone);
  });
for (const timezone of ['', '+03:00', 'UTC+3', 'bad/zone'])
  test(`BF272 invalid IANA ${timezone}`, () => {
    assert.equal(schemas.updateBusinessProfileSchema.safeParse({ timezone }).success, false);
  });
for (const input of [
  {},
  { is_active: false },
  { timezone: null },
  { appointment_interval_minutes: 0 },
  { default_service_buffer_minutes: -1 },
  { appointment_interval_minutes: 1.5 },
  { default_service_buffer_minutes: 2147483648 },
  { low_stock_notifications: 1 },
])
  test(`BF272 invalid patch ${JSON.stringify(input)}`, () => {
    const schema =
      'timezone' in input || 'is_active' in input
        ? schemas.updateBusinessProfileSchema
        : schemas.updateBusinessPreferencesSchema;
    assert.equal(schema.safeParse(input).success, false);
  });
test('BF272 preference partial uses only approved fields and accepts zero buffer', () => {
  assert.deepEqual(
    schemas.updateBusinessPreferencesSchema.parse({
      default_service_buffer_minutes: 0,
      payment_methods: [],
      business_id: 'other',
    }),
    { default_service_buffer_minutes: 0 },
  );
});
function service(result, reject = false) {
  const calls = [];
  const operation =
    (name) =>
    (...args) => {
      calls.push([name, ...args]);
      return reject ? Promise.reject(new Error('sensitive')) : Promise.resolve(result);
    };
  const h = load('services/businessSettingsService', {
    '../repositories/businessConfigurationRepository': {
      businessConfigurationRepository: {
        getByBusinessId: operation('getProfile'),
        update: operation('profile'),
      },
    },
    '../repositories/businessSettingsRepository': {
      businessSettingsRepository: {
        getByBusinessId: operation('getPreferences'),
        update: operation('preferences'),
      },
    },
  });
  return { ...h, calls };
}
test('BF272 service validates before writing; strips managed fields and uses explicit business', async () => {
  const h = service({ data: profile, error: null, status: 200 });
  assert.equal(
    (await h.businessSettingsService.updateProfile('b', { timezone: 'bad' })).error.code,
    'INVALID_SETTINGS',
  );
  assert.equal(h.calls.length, 0);
  assert.equal(
    (
      await h.businessSettingsService.updateProfile('b', {
        name: ' A ',
        id: 'other',
        is_active: false,
      })
    ).data,
    profile,
  );
  assert.deepEqual(h.calls, [['profile', 'b', { name: ' A ' }]]);
});
for (const [code, status, expected] of [
  ['P0272', 400, 'BUSINESS_CURRENCY_LOCKED'],
  ['42501', 403, 'BUSINESS_ACCESS_DENIED'],
  ['x', 0, 'NETWORK_ERROR'],
  ['40001', 400, 'UNKNOWN_ERROR'],
])
  test(`BF272 safe service error ${code}`, async () => {
    const h = service({
      data: null,
      error: { code, message: 'sensitive SQL', details: 'private' },
      status,
    });
    const result = await h.businessSettingsService.updateProfile('b', { currency_code: 'USD' });
    assert.equal(result.error.code, expected);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
    assert(!JSON.stringify(result).includes('sensitive'));
  });
test('BF272 missing settings and rejected SDK are safe, not fake defaults/success', async () => {
  const h = service({ data: null, error: null, status: 200 });
  assert.equal((await h.businessSettingsService.get('b')).error.code, 'SETTINGS_NOT_FOUND');
  assert.equal(
    (await service(null, true).businessSettingsService.get('b')).error.code,
    'UNKNOWN_ERROR',
  );
});
for (const table of ['businesses', 'business_settings'])
  test(`BF272 installed SDK allowlisted tenant PATCH ${table}`, async () => {
    const requests = [];
    const client = createClient('https://synthetic.supabase.co', 'public-test', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, options) => {
          requests.push({ url: new URL(input), options });
          return new Response(JSON.stringify([table === 'businesses' ? profile : preferences]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    });
    const file =
      table === 'businesses'
        ? 'repositories/businessConfigurationRepository'
        : 'repositories/businessSettingsRepository';
    const key =
      table === 'businesses' ? 'businessConfigurationRepository' : 'businessSettingsRepository';
    try {
      const repository = load(file, { '@/lib/supabase/client': { supabase: client } })[key];
      await repository.update('b', {
        name: ' A ',
        phone: null,
        default_service_buffer_minutes: 0,
        is_active: false,
        business_id: 'other',
        id: 'other',
        updated_at: 'x',
      });
      assert.equal(requests.length, 1);
      const { url, options } = requests[0];
      assert.equal(options.method, 'PATCH');
      assert.equal(url.pathname, '/rest/v1/' + table);
      assert.equal(url.searchParams.get(table === 'businesses' ? 'id' : 'business_id'), 'eq.b');
      assert.equal(url.searchParams.get('select').includes('*'), false);
      assert.deepEqual(
        JSON.parse(options.body),
        table === 'businesses'
          ? { name: ' A ', phone: null }
          : { default_service_buffer_minutes: 0 },
      );
    } finally {
      client.auth.stopAutoRefresh();
    }
  });
