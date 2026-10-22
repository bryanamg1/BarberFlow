/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const query = require('@tanstack/react-query');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const contextFile = path.join(root, 'src/features/business/context/BusinessContext.tsx');
const idle = { status: 'idle', data: null, error: null, isFetching: false };
const pending = (isFetching) => ({ status: 'pending', data: null, error: null, isFetching });
const success = (role = 'OWNER', isFetching = false, id = 'A') => ({
  status: 'success',
  data: {
    membershipId: `synthetic-membership-${id}`,
    role,
    business: {
      id: `synthetic-business-${id}`,
      name: `Business ${id}`,
      currency_code: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      is_active: true,
    },
  },
  error: null,
  isFetching,
});

function compile(file, localRequire) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

// Only BF-102 is mocked: the context and React rendering are real. Any direct lower-layer
// dependency, store or navigation import fails instead of being silently substituted.
function loadContext(readHook) {
  const exports = compile(contextFile, (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.equal(name, '../hooks/useCurrentBusiness');
    return { useCurrentBusiness: readHook };
  });
  assert.deepEqual(Object.keys(exports).sort(), ['BusinessProvider', 'useBusiness']);
  assert.equal(exports.useBusiness.length, 0);
  return exports;
}

const states = [
  idle,
  pending(false),
  pending(true),
  success('OWNER'),
  success('OWNER', true),
  success('BARBER'),
];
for (const [index, state] of states.entries()) {
  test(`BF-103: ${state.status}/${state.isFetching}/${index} reaches all consumers unchanged with one hook read`, () => {
    let calls = 0;
    const { BusinessProvider, useBusiness } = loadContext(() => {
      calls++;
      return state;
    });
    const seen = [];
    function Consumer() {
      const value = useBusiness();
      seen.push(value);
      return React.createElement('span', null, value.status);
    }
    const html = renderToStaticMarkup(
      React.createElement(
        BusinessProvider,
        null,
        React.createElement(Consumer),
        React.createElement(Consumer),
      ),
    );
    assert.equal(calls, 1);
    assert.equal(html, `<span>${state.status}</span><span>${state.status}</span>`);
    assert.equal(seen.length, 2);
    for (const value of seen) {
      assert.equal(value, state);
      assert.equal(value.data, state.data);
      assert.equal(value.isFetching, state.isFetching);
    }
  });
}

for (const code of [
  'NO_ACTIVE_MEMBERSHIP',
  'AMBIGUOUS_CURRENT_BUSINESS',
  'BUSINESS_NOT_RESOLVABLE',
  'BUSINESS_INACTIVE',
  'NETWORK_ERROR',
  'BUSINESS_ACCESS_DENIED',
  'UNKNOWN_ERROR',
]) {
  test(`BF-103: ${code} and its safe message are preserved without domain reclassification`, () => {
    for (const isFetching of [false, true]) {
      const error = { code, message: 'Mensaje seguro de BF-101/BF-102.' };
      const state = { status: 'error', data: null, error, isFetching };
      const { BusinessProvider, useBusiness } = loadContext(() => state);
      function Consumer() {
        const value = useBusiness();
        assert.equal(value, state);
        assert.equal(value.error, error);
        assert.equal(value.error.code, code);
        assert.equal(value.error.message, error.message);
        assert.equal(value.data, null);
        assert.equal(value.isFetching, isFetching);
        return null;
      }
      assert.equal(
        renderToStaticMarkup(
          React.createElement(BusinessProvider, null, React.createElement(Consumer)),
        ),
        '',
      );
    }
  });
}

test('BF-103: useBusiness outside BusinessProvider throws a clear developer error without querying', () => {
  let reads = 0;
  const { useBusiness } = loadContext(() => {
    reads++;
    return idle;
  });
  function Consumer() {
    useBusiness();
    return null;
  }
  assert.throws(() => renderToStaticMarkup(React.createElement(Consumer)), {
    name: 'Error',
    message: 'useBusiness debe usarse dentro de BusinessProvider.',
  });
  assert.equal(reads, 0);
});

test('BF-103: provider rerenders distribute logout/recovery idle and user B without local stale data', () => {
  let state;
  let reads = 0;
  const { BusinessProvider, useBusiness } = loadContext(() => {
    reads++;
    return state;
  });
  const seen = [];
  function Consumer() {
    seen.push(useBusiness());
    return null;
  }
  const sequence = [
    success(),
    idle,
    success(),
    idle,
    pending(false),
    pending(true),
    success('BARBER', false, 'B'),
  ];
  for (const next of sequence) {
    state = next;
    // Same module/provider function, no state/effect copy; the value is the exact current hook result.
    const element = BusinessProvider({ children: React.createElement(Consumer) });
    assert.equal(element.props.value, next);
    renderToStaticMarkup(element);
    assert.equal(seen.at(-1), next);
    if (next.status !== 'success') assert.equal(seen.at(-1).data, null);
  }
  assert.equal(reads, sequence.length);
  assert.equal(seen.at(-1).data.business.id, 'synthetic-business-B');
});

test('BF-103: nested provider instances read once each and retain independent context scopes', () => {
  const a = success('OWNER', false, 'A');
  const b = success('BARBER', false, 'B');
  const results = [a, b];
  const { BusinessProvider, useBusiness } = loadContext(() => results.shift());
  const seen = [];
  function Consumer({ label }) {
    seen.push([label, useBusiness()]);
    return null;
  }
  renderToStaticMarkup(
    React.createElement(
      BusinessProvider,
      null,
      React.createElement(Consumer, { label: 'outer-before' }),
      React.createElement(
        BusinessProvider,
        null,
        React.createElement(Consumer, { label: 'inner' }),
      ),
      React.createElement(Consumer, { label: 'outer-after' }),
    ),
  );
  assert.deepEqual(seen, [
    ['outer-before', a],
    ['inner', b],
    ['outer-after', a],
  ]);
  assert.equal(results.length, 0);
});

test('BF-103: real root renders BusinessProvider under both required providers without bypassing the font gate', (t) => {
  const client = new query.QueryClient();
  t.after(() => client.clear());
  const authScope = React.createContext(false);
  let loaded = true;
  let hookCalls = 0;
  let routingCalls = 0;
  let lifecycleCalls = 0;
  let checkoutLifecycleCalls = 0;
  const { BusinessProvider, useBusiness } = loadContext(() => {
    assert.equal(query.useQueryClient(), client, 'QueryProvider must be above BusinessProvider');
    assert.equal(React.useContext(authScope), true, 'AuthProvider must be above BusinessProvider');
    hookCalls++;
    return idle;
  });
  function AuthProvider({ children }) {
    assert.equal(query.useQueryClient(), client, 'QueryProvider must also wrap AuthProvider');
    return React.createElement(authScope.Provider, { value: true }, children);
  }
  function QueryProvider({ children }) {
    return React.createElement(query.QueryClientProvider, { client }, children);
  }
  function AuthNavigator() {
    assert.equal(useBusiness(), idle, 'BusinessProvider must wrap routing');
    routingCalls++;
    return React.createElement('span', null, 'routing');
  }
  function PurchaseDraftLifecycle() {
    assert.equal(useBusiness(), idle, 'BusinessProvider must wrap draft lifecycle');
    assert.equal(React.useContext(authScope), true, 'AuthProvider must wrap draft lifecycle');
    lifecycleCalls++;
    return null;
  }
  function CheckoutDraftLifecycle() {
    assert.equal(useBusiness(), idle, 'BusinessProvider must wrap checkout lifecycle');
    assert.equal(React.useContext(authScope), true, 'AuthProvider must wrap checkout lifecycle');
    checkoutLifecycleCalls++;
    return null;
  }
  const layout = compile(path.join(root, 'src/app/_layout.tsx'), (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name.startsWith('@expo-google-fonts/inter/')) return new Proxy({}, { get: () => 1 });
    if (name === 'expo-font')
      return { FontDisplay: { BLOCK: 'block' }, useFonts: () => [loaded, null] };
    if (name === 'expo-splash-screen')
      return { preventAutoHideAsync: () => Promise.resolve(), hide: () => {} };
    if (name === '@/features/auth/context/AuthContext') return { AuthProvider };
    if (name === '@/features/auth/routing/AuthNavigator') return { AuthNavigator };
    if (name === '@/features/purchases/store/PurchaseDraftLifecycle')
      return { PurchaseDraftLifecycle };
    if (name === '@/features/sales/store/CheckoutDraftLifecycle') return { CheckoutDraftLifecycle };
    if (name === '@/features/business/context/BusinessContext') return { BusinessProvider };
    if (name === '@/lib/query') return { QueryProvider };
    assert.equal(name, '@/theme/typography');
    return {
      fontFamilies: { regular: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold' },
    };
  });
  assert.equal(renderToStaticMarkup(React.createElement(layout.default)), '<span>routing</span>');
  assert.equal(hookCalls, 1);
  assert.equal(routingCalls, 1);
  assert.equal(lifecycleCalls, 1);
  assert.equal(checkoutLifecycleCalls, 1);
  loaded = false;
  assert.equal(renderToStaticMarkup(React.createElement(layout.default)), '');
  assert.equal(hookCalls, 1);
  assert.equal(routingCalls, 1);
  assert.equal(lifecycleCalls, 1);
  assert.equal(checkoutLifecycleCalls, 1);
  assert.deepEqual(layout.unstable_settings, { initialRouteName: '(app)' });
});

test('BF-103: public context type aliases BF-102 exactly and exposes no setters or extra state', () => {
  const file = path.join(root, 'tests/__bf103_type_contract__.ts');
  const source = `
    import { BusinessProvider, useBusiness, type BusinessContextValue } from '@/features/business/context/BusinessContext';
    import type { UseCurrentBusinessResult } from '@/features/business/hooks/useCurrentBusiness';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type Alias = Assert<Equal<BusinessContextValue,UseCurrentBusinessResult>>;
    export type Consumer = Assert<Equal<typeof useBusiness,()=>UseCurrentBusinessResult>>;
    export type Children = Assert<Equal<Parameters<typeof BusinessProvider>[0], import('react').PropsWithChildren>>;
    // @ts-expect-error No local setter or selector.
    useBusiness().setBusiness('arbitrary');
    // @ts-expect-error Internal Context is not part of the public API.
    import { BusinessContext } from '@/features/business/context/BusinessContext';
    void BusinessContext;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) =>
    path.resolve(name) === file
      ? ts.createSourceFile(name, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(name, ...args);
  const program = ts.createProgram(
    [file, ...fileNames.filter((name) => name.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }),
  );
});
