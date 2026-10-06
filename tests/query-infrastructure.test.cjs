/* global __dirname, setImmediate */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const query = require('@tanstack/react-query');

const root = path.resolve(__dirname, '..');
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Load the actual infrastructure with controllable native events and a delayed OS snapshot.
function loadQuery(platform, currentState = 'active', realReact = false) {
  const cache = new Map();
  const effects = [];
  const appListeners = new Set();
  const networkListeners = new Set();
  let resolveNetwork;
  let rejectNetwork;
  let networkReads = 0;
  const initialNetwork = new Promise((resolve, reject) => {
    resolveNetwork = resolve;
    rejectNetwork = reject;
  });

  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'react') {
        return realReact ? React : { useEffect: (effect) => effects.push(effect) };
      }
      if (name === 'react-native') {
        return {
          Platform: { OS: platform },
          AppState: {
            currentState,
            addEventListener: (event, listener) => {
              assert.equal(event, 'change');
              appListeners.add(listener);
              return { remove: () => appListeners.delete(listener) };
            },
          },
        };
      }
      if (name === 'expo-network') {
        return {
          addNetworkStateListener: (listener) => {
            networkListeners.add(listener);
            return { remove: () => networkListeners.delete(listener) };
          },
          getNetworkStateAsync: () => {
            networkReads++;
            return initialNetwork;
          },
        };
      }
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), name);
        const target = ['.ts', '.tsx', '/index.ts']
          .map((extension) => base + extension)
          .find((candidate) => fs.existsSync(candidate));
        assert(target, `Module not found: ${name}`);
        return load(target);
      }
      return require(name);
    };
    vm.runInThisContext(`(function(require, module, exports) {${compiled}\n})`, {
      filename: absolute,
    })(localRequire, module, module.exports);
    return module.exports;
  }

  const infrastructure = load('src/lib/query/index.ts');
  return {
    ...infrastructure,
    load,
    appListeners,
    networkListeners,
    networkReads: () => networkReads,
    resolveNetwork,
    rejectNetwork,
    mount: () => {
      const element = infrastructure.QueryProvider({ children: 'content' });
      return { element, cleanup: effects.pop()() };
    },
    emitApp: (state) => appListeners.forEach((listener) => listener(state)),
    emitNetwork: (state) => networkListeners.forEach((listener) => listener(state)),
  };
}

function resetManagers() {
  query.focusManager.setFocused(undefined);
  query.onlineManager.setOnline(true);
}

test('One shared client is provided across renders, with bounded reads and no mutation retries', () => {
  const infrastructure = loadQuery('web');
  const first = infrastructure.mount();
  const second = infrastructure.mount();
  assert.equal(first.element.type, query.QueryClientProvider);
  assert.equal(first.element.props.client, infrastructure.queryClient);
  assert.equal(second.element.props.client, infrastructure.queryClient);
  assert.equal(
    infrastructure.load('src/lib/query/client.ts').queryClient,
    infrastructure.queryClient,
  );
  const { queries, mutations } = infrastructure.queryClient.getDefaultOptions();
  assert.equal(queries.staleTime, 60_000);
  assert.equal(queries.gcTime, 300_000);
  assert.equal(queries.retry, 2);
  assert.equal(mutations.retry, 0);
  assert.equal(infrastructure.queryClient.getQueryCache().getAll().length, 0);
  assert.equal(infrastructure.queryClient.getMutationCache().getAll().length, 0);
});

for (const platform of ['ios', 'android']) {
  test(`${platform}: initial state, background/inactive/active focus and connectivity`, async (t) => {
    resetManagers();
    const infrastructure = loadQuery(platform, 'background');
    const { cleanup } = infrastructure.mount();
    t.after(() => {
      cleanup();
      resetManagers();
    });
    assert.equal(query.focusManager.isFocused(), false);
    infrastructure.emitApp('active');
    assert.equal(query.focusManager.isFocused(), true);
    infrastructure.emitApp('inactive');
    assert.equal(query.focusManager.isFocused(), false);
    infrastructure.resolveNetwork({ isConnected: false });
    await flush();
    assert.equal(query.onlineManager.isOnline(), false);
    infrastructure.emitNetwork({ isConnected: true, isInternetReachable: false });
    assert.equal(query.onlineManager.isOnline(), false);
    infrastructure.emitNetwork({ isConnected: true, isInternetReachable: true });
    assert.equal(query.onlineManager.isOnline(), true);
    infrastructure.emitNetwork({});
    assert.equal(query.onlineManager.isOnline(), true);
  });
}

test('A newer network event wins over a delayed initial snapshot', async (t) => {
  resetManagers();
  const infrastructure = loadQuery('ios');
  const { cleanup } = infrastructure.mount();
  t.after(() => {
    cleanup();
    resetManagers();
  });
  infrastructure.emitNetwork({ isConnected: false });
  infrastructure.resolveNetwork({ isConnected: true });
  await flush();
  assert.equal(query.onlineManager.isOnline(), false);
});

test('Unmount cancels late updates and remount keeps exactly one native listener of each kind', async () => {
  resetManagers();
  const infrastructure = loadQuery('android');
  const first = infrastructure.mount();
  const queuedAppEvent = [...infrastructure.appListeners][0];
  const queuedNetworkEvent = [...infrastructure.networkListeners][0];
  first.cleanup();
  assert.equal(infrastructure.appListeners.size, 0);
  assert.equal(infrastructure.networkListeners.size, 0);
  queuedAppEvent('background');
  queuedNetworkEvent({ isConnected: false });
  infrastructure.resolveNetwork({ isConnected: false });
  await flush();
  assert.equal(query.focusManager.isFocused(), true);
  assert.equal(query.onlineManager.isOnline(), true);
  const second = infrastructure.mount();
  assert.equal(infrastructure.appListeners.size, 1);
  assert.equal(infrastructure.networkListeners.size, 1);
  await flush();
  assert.equal(query.onlineManager.isOnline(), false);
  second.cleanup();
  resetManagers();
});

test('Unknown AppState and failed network lookup retain usable manager state', async (t) => {
  resetManagers();
  const infrastructure = loadQuery('ios', null);
  const { cleanup } = infrastructure.mount();
  t.after(() => {
    cleanup();
    resetManagers();
  });
  infrastructure.rejectNetwork(new Error('OS state unavailable'));
  await flush();
  assert.equal(query.onlineManager.isOnline(), true);
  assert.equal(query.focusManager.isFocused(), true);
  infrastructure.emitNetwork({ isConnected: false });
  assert.equal(query.onlineManager.isOnline(), false);
});

test('Web leaves native subscriptions untouched and provides context during server rendering', () => {
  const infrastructure = loadQuery('web');
  infrastructure.mount();
  assert.equal(infrastructure.appListeners.size, 0);
  assert.equal(infrastructure.networkListeners.size, 0);
  assert.equal(infrastructure.networkReads(), 0);
  const server = loadQuery('web', 'active', true);
  function Consumer() {
    assert.equal(query.useQueryClient(), server.queryClient);
    return React.createElement('span', null, 'provided');
  }
  assert.equal(
    renderToStaticMarkup(
      React.createElement(server.QueryProvider, null, React.createElement(Consumer)),
    ),
    '<span>provided</span>',
  );
});

test('Real QueryClient pauses offline reads, resumes on reconnect and refreshes only stale data on focus', async (t) => {
  resetManagers();
  const infrastructure = loadQuery('ios');
  const { cleanup } = infrastructure.mount();
  const client = infrastructure.queryClient;
  client.mount();
  let reads = 0;
  const options = { queryKey: ['infrastructure-test'], queryFn: async () => ++reads };
  const observer = new query.QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  t.after(() => {
    unsubscribe();
    client.unmount();
    client.clear();
    cleanup();
    resetManagers();
  });
  assert.equal(await client.fetchQuery(options), 1);
  infrastructure.emitApp('background');
  infrastructure.emitApp('active');
  await flush();
  assert.equal(reads, 1);
  await client.invalidateQueries({ refetchType: 'none' });
  infrastructure.emitApp('background');
  infrastructure.emitApp('active');
  await flush();
  assert.equal(reads, 2);
  infrastructure.emitNetwork({ isConnected: false });
  const pending = observer.refetch();
  assert.equal(observer.getCurrentResult().fetchStatus, 'paused');
  await flush();
  assert.equal(reads, 2);
  infrastructure.emitNetwork({ isConnected: true, isInternetReachable: true });
  await pending;
  assert.equal(reads, 3);
});

test('A failed mutation executes once without an automatic retry', async (t) => {
  resetManagers();
  const { queryClient } = loadQuery('web');
  t.after(() => queryClient.clear());
  let writes = 0;
  const mutation = new query.MutationObserver(queryClient, {
    mutationFn: async () => {
      writes++;
      throw new Error('Test failure');
    },
  });
  await assert.rejects(mutation.mutate(), /Test failure/);
  assert.equal(writes, 1);
});
