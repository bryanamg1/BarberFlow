/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '../src/features/clients');
function load(relative, dependencies = {}) {
  const file = path.join(root, relative + '.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      assert.ok(name.startsWith('.'), `Unexpected dependency ${name}`);
      return load(path.relative(root, path.resolve(path.dirname(file), name)));
    },
    module,
    module.exports,
  );
  return module.exports;
}
const raw = (overrides = {}) => ({
  total_appointments: '9223372036854775807',
  completed_visits: '4',
  no_show_count: '2',
  last_visit_at: '2026-01-01T00:00:00+00:00',
  next_appointment_at: '2026-02-01T00:00:00.123456+00:00',
  total_spent: '900719925474099312345.29',
  ...overrides,
});
const result = (data = [raw()]) => ({ data, error: null, status: 200 });
function service(operation) {
  return load('services/clientStatsService', {
    '../repositories/clientStatsRepository': { clientStatsRepository: { getByClient: operation } },
  }).clientStatsService;
}

test('BF-121 repository uses the installed SDK RPC and six lossless projected columns exactly once', async () => {
  const requests = [];
  const sdk = createClient('http://fixture.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(JSON.stringify([raw()]), { status: 200 });
      },
    },
  });
  const repo = load('repositories/clientStatsRepository', {
    '@/lib/supabase/client': { supabase: sdk },
  }).clientStatsRepository;
  const response = await repo.getByClient(' original Business ', ' original Client ');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/rest/v1/rpc/get_client_stats');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    p_business_id: ' original Business ',
    p_client_id: ' original Client ',
  });
  assert.equal(
    requests[0].url.searchParams.get('select'),
    'total_appointments::text,completed_visits::text,no_show_count::text,last_visit_at,next_appointment_at,total_spent::text',
  );
  assert.deepEqual(response.data, [raw()]);
  assert.equal(response.error, null);
});

test('BF-121 repository preserves SDK failure for service normalization', async () => {
  const error = { code: '42501', message: 'private', details: 'private', hint: 'private' };
  const response = { data: null, error, status: 403 };
  const repo = load('repositories/clientStatsRepository', {
    '@/lib/supabase/client': { supabase: { rpc: () => ({ select: () => response }) } },
  }).clientStatsRepository;
  assert.equal(await repo.getByClient('b', 'c'), response);
});

test('BF-121 service maps once, preserves unbounded counts, exact cents and timestamp instants', async () => {
  const calls = [];
  const response = await service(async (...args) => {
    calls.push(args);
    return result();
  }).getByClient(' original B ', ' original C ');
  assert.deepEqual(calls, [[' original B ', ' original C ']]);
  assert.deepEqual(response, {
    data: {
      totalAppointments: '9223372036854775807',
      completedVisits: '4',
      noShowCount: '2',
      lastVisitAt: raw().last_visit_at,
      nextAppointmentAt: raw().next_appointment_at,
      totalSpent: '900719925474099312345.29',
    },
    error: null,
  });
});

for (const money of [null, '0.00', '0.29', '19999999999.98']) {
  test(`BF-121 service preserves financial null/zero/precision ${money}`, async () => {
    const response = await service(async () => result([raw({ total_spent: money })])).getByClient(
      'b',
      'c',
    );
    assert.equal(response.error, null);
    assert.equal(response.data.totalSpent, money);
  });
}
test('BF-121 zero activity remains a successful result', async () => {
  const response = await service(async () =>
    result([
      raw({
        total_appointments: '0',
        completed_visits: '0',
        no_show_count: '0',
        last_visit_at: null,
        next_appointment_at: null,
        total_spent: '0.00',
      }),
    ]),
  ).getByClient('b', 'c');
  assert.equal(response.error, null);
  assert.equal(response.data.totalAppointments, '0');
  assert.equal(response.data.lastVisitAt, null);
});
for (const [label, data] of [
  ['null', null],
  ['empty', []],
  ['multiple', [raw(), raw()]],
  ['object', raw()],
  ['missing field', [{ ...raw(), no_show_count: undefined }]],
  ...[-1, 2, 9007199254740992, '01', '-1', '1.0', '1e3', 'NaN', '', ' 1'].map((value) => [
    `bad count ${value}`,
    [raw({ total_appointments: value })],
  ]),
  ...[0.29, 'NaN', '-0.01', '1', '1.001', '1e3', '01.00'].map((value) => [
    `bad money ${value}`,
    [raw({ total_spent: value })],
  ]),
  ['bad instant', [raw({ last_visit_at: 'not a date' })]],
  ['missing timezone', [raw({ next_appointment_at: '2026-01-01T00:00:00' })]],
]) {
  test(`BF-121 malformed transport rejects safely: ${label}`, async () => {
    const response = await service(async () => result(data)).getByClient('b', 'c');
    assert.equal(response.data, null);
    assert.equal(response.error.code, 'UNKNOWN_ERROR');
  });
}
for (const [status, code, expected] of [
  [0, '', 'NETWORK_ERROR'],
  [401, '', 'CLIENT_ACCESS_DENIED'],
  [403, '', 'CLIENT_ACCESS_DENIED'],
  [400, '42501', 'CLIENT_ACCESS_DENIED'],
  [400, 'P0002', 'CLIENT_NOT_FOUND'],
  [400, '22023', 'UNKNOWN_ERROR'],
  [500, 'XX000', 'UNKNOWN_ERROR'],
]) {
  test(`BF-121 structured error ${status}/${code} normalizes without raw details`, async () => {
    const response = await service(async () => ({
      data: null,
      status,
      error: { code, message: 'sensitive', hint: 'sensitive', details: 'sensitive' },
    })).getByClient('b', 'c');
    assert.equal(response.error.code, expected);
    assert.equal(response.data, null);
    assert.deepEqual(Object.keys(response.error), ['code', 'message']);
    assert.ok(!JSON.stringify(response).includes('sensitive'));
  });
}
test('BF-121 unexpected rejection stays safe', async () => {
  const response = await service(async () => {
    throw new Error('sensitive');
  }).getByClient('b', 'c');
  assert.equal(response.error.code, 'UNKNOWN_ERROR');
  assert.ok(!JSON.stringify(response).includes('sensitive'));
});
test('BF-121 cache key isolates business/client/user/role/lifetime under business prefix', () => {
  const { clientsKeys: keys } = load('constants/clientsKeys');
  const key = keys.stats('b', 'c', 'u', 'OWNER');
  assert.deepEqual(key, ['clients', 'b', 'detail', 'c', 'stats', 'u', 'OWNER', 'lifetime']);
  assert.deepEqual(key.slice(0, 2), keys.byBusiness('b'));
  for (const variant of [
    keys.stats('b2', 'c', 'u', 'OWNER'),
    keys.stats('b', 'c2', 'u', 'OWNER'),
    keys.stats('b', 'c', 'u2', 'OWNER'),
    keys.stats('b', 'c', 'u', 'BARBER'),
  ])
    assert.notDeepEqual(key, variant);
});
test('BF-121 exact monetary formatter keeps cents above safe integer and uses business currency', () => {
  const { formatClientStatsMoney: format } = load('utils/clientStatsFormat');
  assert.match(format('900719925474099312345.29', 'ARS'), /900\.719\.925\.474\.099\.312\.345,29/);
  assert.match(format('0.00', 'USD'), /USD.*0,00/);
  assert.match(format('1.01', 'EUR'), /EUR.*1,01/);
});
test('BF-121 timestamps use supplied business timezone, including DST', () => {
  const { formatClientStatsDate: format } = load('utils/clientStatsFormat');
  assert.match(
    format('2026-01-01T00:00:00Z', 'America/Argentina/Buenos_Aires'),
    /31.*dic.*2025.*21:00/,
  );
  assert.match(format('2026-07-01T12:00:00Z', 'America/New_York'), /08:00/);
  assert.match(format('2026-01-01T12:00:00Z', 'America/New_York'), /07:00/);
  assert.equal(format('invalid', 'UTC'), 'Fecha no disponible');
  assert.equal(format('2026-01-01T00:00:00Z', 'invalid'), 'Fecha no disponible');
});
