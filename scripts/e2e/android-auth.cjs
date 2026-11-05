const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { guard } = require('../../tests/e2e/helpers/environment.cjs');
const { target } = require('./android.cjs');

// Hermes DevTools transport, exclusively for the attested local test APK. Never log CDP
// responses: Auth credentials remain on device; each expression returns metadata only.
function validateTarget(page) {
  assert.equal(page.appId, target.appId);
  const url = new URL(page.webSocketDebuggerUrl);
  assert.equal(url.origin, `ws://127.0.0.1:${target.metroPort}`);
  assert.equal(url.pathname, '/inspector/debug');
  assert.ok(url.searchParams.get('device') && url.searchParams.get('page'));
  return url.href;
}

function observationExpression(expression, id) {
  assert.ok(Number.isSafeInteger(id) && id > 0);
  // Hermes in this build ignores CDP awaitPromise and serializes Promise internals.
  // Resolve on-device, then poll only the completed metadata. Invoke the action once.
  return `(() => {
    const observation = { id: ${id}, done: false };
    globalThis.__bf305Observation = observation;
    Promise.resolve().then(() => (${expression})).then(value => {
      observation.value = value;
      observation.done = true;
    }, () => { observation.failed = true; observation.done = true; });
    return true;
  })()`;
}

async function connect() {
  guard();
  const response = await fetch(`http://127.0.0.1:${target.metroPort}/json/list`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(response.ok);
  const pages = (await response.json()).filter((page) => page.appId === target.appId);
  assert.equal(pages.length, 1, 'Expected one attested native runtime');
  // Metro's inspector requires an explicit loopback DevTools Origin. Node's built-in
  // WebSocket omits it; use Metro's already-installed ws transport, no new dependency.
  const socket = new WebSocket(validateTarget(pages[0]), {
    origin: `http://127.0.0.1:${target.metroPort}`,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Native inspector unavailable'));
    }, 10000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('Native inspector unavailable'));
      },
      { once: true },
    );
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data);
    const request = pending.get(result.id);
    if (!request) return; // Discard console/network/SDK events without persisting them.
    pending.delete(result.id);
    clearTimeout(request.timeout);
    if (result.error || result.result?.exceptionDetails)
      request.reject(new Error('Native observation failed'));
    else request.resolve(result.result?.result?.value);
  });
  function rawEvaluate(expression) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('Native observation timed out'));
      }, 15000);
      pending.set(requestId, { resolve, reject, timeout });
      socket.send(
        JSON.stringify({
          id: requestId,
          method: 'Runtime.evaluate',
          params: {
            expression,
            returnByValue: true,
          },
        }),
      );
    });
  }
  let observationId = 0;
  return {
    async evaluate(expression) {
      const current = ++observationId;
      assert.equal(await rawEvaluate(observationExpression(expression, current)), true);
      const deadline = Date.now() + 15000;
      do {
        const result = await rawEvaluate('globalThis.__bf305Observation');
        if (result?.id !== current) throw new Error('Native observation replaced');
        if (result.done) {
          if (result.failed) throw new Error('Native observation failed');
          return result.value;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      throw new Error('Native asynchronous observation timed out');
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error('Inspector closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}

async function observe(runtime) {
  assert.equal(
    await runtime.evaluate(`(() => {
    const modules = globalThis.__r.getModules();
    let client, queryClient;
    for (const module of modules.values()) {
      if (!module.isInitialized) continue;
      const value = module.publicModule.exports;
      if (value?.supabase?.auth) client = value.supabase;
      if (value?.queryClient?.getQueryCache) queryClient = value.queryClient;
    }
    if (!client || !queryClient) return false;
    const runtime = { client, queryClient, events: [] };
    client.auth.onAuthStateChange((event) => runtime.events.push(event));
    globalThis.__bf305Lifecycle = runtime;
    return true;
  })()`),
    true,
  );
}

async function snapshot(runtime, user) {
  // IDs are synthetic fixture identifiers, never credentials or Session payloads.
  const args = JSON.stringify({
    userId: user.userId,
    businessId: user.businessId,
    clientName: user.clientName,
  });
  return runtime.evaluate(`(async () => {
    const user = ${args};
    const runtime = globalThis.__bf305Lifecycle;
    const stored = JSON.parse(await runtime.client.auth.storage.getItem(runtime.client.auth.storageKey) || 'null');
    const count = runtime.queryClient.getQueryCache().getAll().filter(query => {
      if (query.state.data === undefined) return false;
      const text = JSON.stringify([query.queryKey, query.state.data]);
      return [user.userId, user.businessId, user.clientName].some(value => text.includes(value));
    }).length;
    return { persistedSession: !!stored, sameUser: stored?.user?.id === user.userId,
      expiresAt: stored?.expires_at ?? null, privateQueryCount: count,
      signedOutEvents: runtime.events.filter(event => event === 'SIGNED_OUT').length };
  })()`);
}

module.exports = { validateTarget, observationExpression, connect, observe, snapshot };
