/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src');
function load(file, overrides = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const f = ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find(fs.existsSync);
        assert(f, name);
        return load(f, overrides, cache);
      }
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
function row(patch = {}) {
  return {
    id: 'appointment',
    business_id: 'business',
    client_id: 'client',
    barber_member_id: 'member',
    start_at: '2030-01-02T02:00:00Z',
    end_at: '2030-01-02T04:00:00Z',
    status: 'PENDING',
    notes: null,
    created_by: 'actor',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  };
}
function service(response, rejection) {
  const calls = [];
  const repo = {
    getNextAppointment: (...args) => {
      calls.push(args);
      return rejection ? Promise.reject(rejection) : Promise.resolve(response);
    },
  };
  return {
    calls,
    api: load('features/analytics/services/homeService.ts', {
      '../repositories/homeRepository': { homeRepository: repo },
    }).homeService,
  };
}
test('BF261 repository: real SDK calls only the exact RPC with explicit business and optional signal', async () => {
  const requests = [];
  const supabase = createClient('https://bf261.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify(row()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  });
  const { homeRepository } = load('features/analytics/repositories/homeRepository.ts', {
    '@/lib/supabase/client': { supabase },
  });
  const controller = new AbortController();
  const result = await homeRepository.getNextAppointment('business', controller.signal);
  assert.deepEqual(result.data, row());
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, '/rest/v1/rpc/get_next_appointment');
  assert.equal(new URL(requests[0].url).search, '');
  assert.deepEqual(JSON.parse(requests[0].init.body), { p_business_id: 'business' });
  assert.equal(requests[0].init.signal, controller.signal);
});
test('BF261 repository preserves SDK null/error/status and rejection', async () => {
  const expected = {
    data: null,
    error: { code: '42501', message: 'private provider detail' },
    status: 403,
  };
  const builder = Promise.resolve(expected);
  const { homeRepository } = load('features/analytics/repositories/homeRepository.ts', {
    '@/lib/supabase/client': { supabase: { rpc: () => builder } },
  });
  assert.equal(await homeRepository.getNextAppointment('business'), expected);
  const error = new Error('provider rejection');
  const other = load('features/analytics/repositories/homeRepository.ts', {
    '@/lib/supabase/client': { supabase: { rpc: () => Promise.reject(error) } },
  }).homeRepository;
  await assert.rejects(other.getNextAppointment('business'), (e) => e === error);
});
for (const status of ['PENDING', 'CONFIRMED'])
  test(`BF261 service preserves exact ${status} row, original strings and nullable notes`, async () => {
    const source = row({ status, notes: '  original notes  ' });
    const s = service({ data: { ...source, extra: 'strip' }, error: null, status: 200 });
    const signal = new AbortController().signal;
    assert.deepEqual(await s.api.getNextAppointment('business', signal), {
      data: source,
      error: null,
    });
    assert.equal(s.calls[0][1], signal);
  });
test('BF261 success NULL stays success and does not fabricate an appointment', async () => {
  const s = service({ data: null, error: null, status: 200 });
  assert.deepEqual(await s.api.getNextAppointment('business'), { data: null, error: null });
});
for (const [name, patch] of [
  ['missing id', { id: undefined }],
  ['empty reference', { client_id: '  ' }],
  ['wrong tenant', { business_id: 'foreign' }],
  ['invalid start', { start_at: 'not-an-instant' }],
  ['unzonified end', { end_at: '2030-01-02T04:00:00' }],
  ['equal endpoints', { end_at: '2030-01-02T02:00:00Z' }],
  ['reversed endpoints', { end_at: '2030-01-02T01:00:00Z' }],
  ['IN_PROGRESS', { status: 'IN_PROGRESS' }],
  ['COMPLETED', { status: 'COMPLETED' }],
  ['CANCELLED', { status: 'CANCELLED' }],
  ['NO_SHOW', { status: 'NO_SHOW' }],
  ['missing audit', { created_by: undefined }],
  ['malformed notes', { notes: 1 }],
])
  test(`BF261 rejects corrupt ${name} without leaking values`, async () => {
    const s = service({ data: row(patch), error: null, status: 200 });
    const result = await s.api.getNextAppointment('business');
    assert.equal(result.data, null);
    assert.equal(result.error.code, 'INVALID_APPOINTMENT');
    assert(!result.error.message.includes('2030'));
  });
test('BF261 service distinguishes undefined response from genuine NULL', async () => {
  const s = service({ data: undefined, error: null, status: 200 });
  assert.equal((await s.api.getNextAppointment('business')).error.code, 'INVALID_APPOINTMENT');
});
test('BF261 validates context before transport', async () => {
  const s = service({ data: row(), error: null, status: 200 });
  assert.equal((await s.api.getNextAppointment('  ')).error.code, 'INVALID_APPOINTMENT');
  assert.equal(s.calls.length, 0);
});
for (const [status, code, expected] of [
  [403, '42501', 'APPOINTMENT_ACCESS_DENIED'],
  [401, 'bad', 'APPOINTMENT_ACCESS_DENIED'],
  [0, 'fetch', 'NETWORK_ERROR'],
  [500, 'XX000', 'UNKNOWN_ERROR'],
])
  test(`BF261 safe error status ${status}`, async () => {
    const s = service({ data: null, error: { code, message: 'secret raw sql and ids' }, status });
    const r = await s.api.getNextAppointment('business');
    assert.equal(r.error.code, expected);
    assert(!JSON.stringify(r).includes('secret'));
  });
test('BF261 rejected technical string never becomes public raw error', async () => {
  const s = service(null, 'secret transport');
  const r = await s.api.getNextAppointment('business');
  assert.equal(r.error.code, 'UNKNOWN_ERROR');
  assert(!JSON.stringify(r).includes('secret'));
});
test('BF261 instant precision preserves a positive microsecond interval', async () => {
  const source = row({
    start_at: '2030-01-01T00:00:00.000001Z',
    end_at: '2030-01-01T00:00:00.000002Z',
  });
  assert.deepEqual(
    await service({ data: source, error: null, status: 200 }).api.getNextAppointment('business'),
    { data: source, error: null },
  );
});
test('BF261 keys partition tenant, actor, membership, role and timezone without period or time', () => {
  const { homeKeys } = load('features/analytics/constants/homeKeys.ts');
  const scope = { businessId: 'business', userId: 'user', membershipId: 'member', role: 'OWNER' };
  const key = homeKeys.nextAppointment(scope, 'UTC');
  assert.deepEqual(homeKeys.nextAppointment({ ...scope }, 'UTC'), key);
  for (const patch of [
    { businessId: 'B' },
    { userId: 'U' },
    { membershipId: 'M' },
    { role: 'BARBER' },
  ])
    assert.notDeepEqual(homeKeys.nextAppointment({ ...scope, ...patch }, 'UTC'), key);
  assert.notDeepEqual(homeKeys.nextAppointment(scope, 'America/New_York'), key);
  assert(!JSON.stringify(key).includes('period'));
});
test('BF261 architecture has no enrichment, additional RPC, Router in component or final Home composition changes', () => {
  const repo = fs.readFileSync(
    path.join(root, 'features/analytics/repositories/homeRepository.ts'),
    'utf8',
  );
  assert.deepEqual(
    [...repo.matchAll(/\.rpc\('([^']+)'/g)].map((m) => m[1]),
    ['get_next_appointment'],
  );
  assert(!repo.includes('.from('));
  const ui = fs.readFileSync(
    path.join(root, 'features/analytics/components/HomeNextAppointment.tsx'),
    'utf8',
  );
  assert(!/supabase|expo-router|clientsRepository|servicesRepository|membersRepository/.test(ui));
  assert.equal(
    fs.readFileSync(path.join(root, 'app/(app)/(tabs)/index.tsx'), 'utf8').trim(),
    "export { HomeStockScreen as default } from '@/features/analytics/screens/HomeStockScreen';",
  );
});

test('BF261 actual Web DOM: accessible heading/status, native focus and click call host without leaking identifiers', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root" style="width:375px"></div></body></html>',
    { url: 'http://localhost', pretendToBeVisual: true },
  );
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  for (const name of [
    'HTMLElement',
    'Node',
    'Element',
    'SVGElement',
    'ShadowRoot',
    'MutationObserver',
  ])
    global[name] = dom.window[name];
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react'),
    RN = require('react-native-web'),
    { createRoot } = require('react-dom/client');
  const business = {
    status: 'success',
    isFetching: false,
    data: {
      membershipId: 'member',
      role: 'OWNER',
      business: {
        id: 'business',
        timezone: 'America/Argentina/Buenos_Aires',
        currency_code: 'ARS',
      },
    },
  };
  const overrides = {
    'react-native': RN,
    '@/features/auth/context/AuthContext': {
      useAuth: () => ({ status: 'authenticated', user: { id: 'actor' } }),
    },
    '@/features/business/context/BusinessContext': { useBusiness: () => business },
  };
  const webCache = new Map();
  overrides['@/components/ui'] = Object.fromEntries(
    ['Badge', 'Button', 'Card', 'EmptyState', 'ErrorState', 'LoadingState'].map((name) => [
      name,
      load(`components/ui/${name}.tsx`, overrides, webCache)[name],
    ]),
  );
  const { HomeNextAppointment } = load(
    'features/analytics/components/HomeNextAppointment.tsx',
    overrides,
    webCache,
  );
  const app = createRoot(document.getElementById('root'));
  const opened = [];
  try {
    await React.act(async () =>
      app.render(
        React.createElement(HomeNextAppointment, {
          result: { status: 'success', data: row({ status: 'CONFIRMED', notes: 'do not show' }) },
          onOpen: (id) => opened.push(id),
        }),
      ),
    );
    assert.equal(document.querySelector('[role="heading"]').textContent, 'Próximo turno');
    assert(document.body.textContent.includes('Confirmado'));
    assert(!document.body.textContent.includes('do not show'));
    const button = document.querySelector('[role="button"]');
    assert(button);
    await React.act(async () => button.focus());
    assert.equal(document.activeElement, button);
    await React.act(async () => button.click());
    assert.deepEqual(opened, ['appointment']);
    await React.act(async () =>
      app.render(
        React.createElement(HomeNextAppointment, {
          result: { status: 'success', data: null },
          onOpen: (id) => opened.push(id),
        }),
      ),
    );
    assert(document.body.textContent.includes('No hay próximos turnos'));
    assert.equal(document.querySelector('[role="button"]'), null);
  } finally {
    await React.act(async () => app.unmount());
    dom.window.close();
  }
});
