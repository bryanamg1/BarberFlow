/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test'),
  ts = require('typescript');
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
const { agendaPeriod, shiftCivilDate, businessCivilDate } = load(
  'features/appointments/utils/agendaCalendar.ts',
);
const { homeTodaySegments } = load('features/analytics/utils/homeTodayAppointments.ts');
const scope = { businessId: 'b', userId: 'u', membershipId: 'm', role: 'OWNER' };
const period = (date = '2026-10-01', timezone = 'UTC') =>
  agendaPeriod(date, shiftCivilDate(date, 1), timezone);
const row = (
  id,
  start_at = '2026-10-01T10:00:00Z',
  end_at = '2026-10-01T11:00:00Z',
  patch = {},
) => ({
  id,
  business_id: 'b',
  client_id: 'c',
  barber_member_id: 'm',
  start_at,
  end_at,
  status: 'PENDING',
  notes: null,
  created_by: 'u',
  created_at: start_at,
  updated_at: start_at,
  ...patch,
});
for (const [date, from, to, hours] of [
  ['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', 23],
  ['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', 25],
])
  test(`BF262 ${hours}-hour DST civil day uses existing boundaries`, () => {
    const p = period(date, 'America/New_York');
    assert.deepEqual(p.range, { from, to });
    assert.equal(Date.parse(to) - Date.parse(from), hours * 3600000);
  });
test('BF262 business civil date differs from device UTC near midnight', () => {
  assert.equal(
    businessCivilDate(Date.parse('2026-10-02T01:00:00Z'), 'America/Argentina/Buenos_Aires'),
    '2026-10-01',
  );
  assert.deepEqual(period('2026-10-01', 'America/Argentina/Buenos_Aires').range, {
    from: '2026-10-01T03:00:00.000Z',
    to: '2026-10-02T03:00:00.000Z',
  });
});
for (const [name, start, end, included, continued] of [
  ['fully inside', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', true, false],
  ['before to inside', '2026-09-30T23:00:00Z', '2026-10-01T01:00:00Z', true, true],
  ['inside to after', '2026-10-01T23:00:00Z', '2026-10-02T01:00:00Z', true, false],
  ['spans whole day', '2026-09-30T23:00:00Z', '2026-10-02T01:00:00Z', true, true],
  ['ends at lower', '2026-09-30T23:00:00Z', '2026-10-01T00:00:00Z', false, false],
  ['starts at upper', '2026-10-02T00:00:00Z', '2026-10-02T01:00:00Z', false, false],
  ['starts at lower', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z', true, false],
  ['ends at upper', '2026-10-01T23:00:00Z', '2026-10-02T00:00:00Z', true, false],
])
  test(`BF262 half-open intersection ${name}`, () => {
    const r = row(name, start, end),
      out = homeTodaySegments(period(), [r], scope);
    assert.equal(out.length, included ? 1 : 0);
    if (included) {
      assert.equal(out[0].continued, continued);
      assert.equal(out[0].appointment, r);
    }
  });
for (const status of ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
  test(`BF262 retains ${status} and past-today item`, () => {
    const r = Object.freeze(
      row(status, '2026-10-01T00:01:00Z', '2026-10-01T00:02:00Z', { status }),
    );
    const out = homeTodaySegments(period(), [r], scope);
    assert.equal(out[0].appointment, r);
    assert.equal(out[0].appointment.status, status);
  });
test('BF262 multi-day representations keep the same original entity and continuation', () => {
  const r = Object.freeze(row('multi', '2026-10-01T23:00:00Z', '2026-10-03T01:00:00Z'));
  const first = homeTodaySegments(period('2026-10-01'), [r], scope),
    next = homeTodaySegments(period('2026-10-02'), [r], scope);
  assert.equal(first[0].continued, false);
  assert.equal(next[0].continued, true);
  assert.equal(first[0].appointment, r);
  assert.equal(next[0].appointment, r);
  assert.equal(Object.keys(r).length, 11);
});
test('BF262 preserves reader order without local rerank or mutation, and deduplicates same row', () => {
  const a = Object.freeze(row('a')),
    z = Object.freeze(row('z'));
  const data = Object.freeze([z, a, z]);
  const out = homeTodaySegments(period(), data, scope);
  assert.deepEqual(
    out.map((s) => s.appointment.id),
    ['z', 'a'],
  );
  assert.equal(data[0], z);
  assert.equal(out[0].appointment, z);
});
test('BF262 excludes foreign tenants, invalid intervals and inconsistent BARBER assignments', () => {
  const own = row('own'),
    other = row('other', undefined, undefined, { barber_member_id: 'other' }),
    foreign = row('foreign', undefined, undefined, { business_id: 'foreign' }),
    bad = row('bad', 'broken');
  assert.deepEqual(
    homeTodaySegments(period(), [own, other, foreign, bad], { ...scope, role: 'BARBER' }).map(
      (s) => s.appointment.id,
    ),
    ['own'],
  );
  assert.deepEqual(
    homeTodaySegments(period(), [own, other], scope).map((s) => s.appointment.id),
    ['own', 'other'],
  );
});
test('BF262 same-ID corrupt foreign row cannot substitute identity of authorized row', () => {
  const foreign = row('same', undefined, undefined, { business_id: 'foreign' }),
    own = row('same');
  const result = homeTodaySegments(period(), [foreign, own], scope);
  assert.equal(result.length, 1);
  assert.equal(result[0].appointment, own);
});
test('BF262 real existing SDK repository keeps intersection/order/eleven columns without status filter or limit', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const urls = [];
  const supabase = createClient('https://bf262.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url) => {
        urls.push(new URL(url));
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  });
  const { appointmentsRepository } = load(
    'features/appointments/repositories/appointmentsRepository.ts',
    { '@/lib/supabase/client': { supabase } },
  );
  const range = period('2026-03-08', 'America/New_York').range;
  const r = await appointmentsRepository.listByRange('b', range);
  assert.deepEqual(r.data, []);
  const params = urls[0].searchParams;
  assert.equal(urls[0].pathname, '/rest/v1/appointments');
  assert.equal(params.get('business_id'), 'eq.b');
  assert.equal(params.get('start_at'), 'lt.' + range.to);
  assert.equal(params.get('end_at'), 'gt.' + range.from);
  assert.equal(params.get('order'), 'start_at.asc,id.asc');
  assert.equal(params.get('status'), null);
  assert.equal(params.get('limit'), null);
  assert.equal(params.get('select').split(',').length, 11);
});
test('BF262 composition reuses BF146/BF153 only, with no parallel reader or Next result', () => {
  const ui = fs.readFileSync(
    path.join(root, 'features/analytics/components/HomeTodayAppointments.tsx'),
    'utf8',
  );
  assert(ui.includes('useAppointments('));
  assert(ui.includes('<AppointmentCard'));
  assert(ui.includes("'/appointments/[id]'"));
  assert(!/supabase|\.rpc\(|useNextAppointment|homeService|homeRepository|\.sort\(/.test(ui));
});
test('BF262 actual Web DOM uses real hook/card, accessible continuation, focus and existing detail route', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root" style="width:1440px"></div></body></html>',
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
    TQ = require('@tanstack/react-query'),
    { createRoot } = require('react-dom/client');
  TQ.notifyManager.setScheduler(queueMicrotask);
  const now = Date.now;
  Date.now = () => Date.parse('2026-10-01T12:00:00Z');
  const pushed = [],
    calls = [];
  const cache = new Map();
  const business = {
    status: 'success',
    isFetching: false,
    data: {
      membershipId: 'm',
      role: 'OWNER',
      business: { id: 'b', timezone: 'UTC', currency_code: 'ARS' },
    },
  };
  const overrides = {
    'react-native': RN,
    'expo-router': {
      useIsFocused: () => true,
      useRouter: () => ({ push: (value) => pushed.push(value) }),
    },
    '@/features/auth/context/AuthContext': {
      useAuth: () => ({ status: 'authenticated', user: { id: 'u' } }),
    },
    '@/features/business/context/BusinessContext': { useBusiness: () => business },
    '../services/appointmentsService': {
      appointmentsService: {
        listByRange: async (...args) => {
          calls.push(args);
          return {
            data: [row('web', '2026-09-30T23:00:00Z', '2026-10-01T13:00:00Z')],
            error: null,
          };
        },
      },
    },
  };
  overrides['@/components/ui'] = Object.fromEntries(
    ['Button', 'Card', 'EmptyState', 'ErrorState', 'LoadingState'].map((name) => [
      name,
      load('components/ui/' + name + '.tsx', overrides, cache)[name],
    ]),
  );
  const { HomeTodayAppointments } = load(
    'features/analytics/components/HomeTodayAppointments.tsx',
    overrides,
    cache,
  );
  const client = new TQ.QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  const app = createRoot(document.getElementById('root'));
  try {
    await React.act(async () =>
      app.render(
        React.createElement(
          TQ.QueryClientProvider,
          { client },
          React.createElement(HomeTodayAppointments),
        ),
      ),
    );
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const button = document.querySelector('[role="button"]');
    assert(button);
    assert(button.textContent.includes('Continúa'));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      'b',
      { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' },
    ]);
    await React.act(async () => button.focus());
    assert.equal(document.activeElement, button);
    await React.act(async () => button.click());
    assert.deepEqual(pushed, [{ pathname: '/appointments/[id]', params: { id: 'web' } }]);
  } finally {
    await React.act(async () => app.unmount());
    client.clear();
    Date.now = now;
    dom.window.close();
  }
});
