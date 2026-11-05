const { manifest } = require('./environment.cjs');

async function observeRuntime(page) {
  await page.addInitScript(
    ({ origin }) => {
      if (location.origin !== origin) return;
      const observation = { client: null, queryClient: null, events: [] };
      // Observe the real dev-bundle exports; do not replace Auth, providers, cache or storage.
      let define;
      Object.defineProperty(globalThis, '__d', {
        configurable: true,
        get: () => define,
        set(original) {
          define = function (factory, ...registration) {
            return original(
              function (...args) {
                const result = Reflect.apply(factory, this, args);
                const exports = args[4]?.exports;
                if (!observation.client && exports?.supabase?.auth) {
                  observation.client = exports.supabase;
                  observation.client.auth.onAuthStateChange((event, session) => {
                    observation.events.push({ event, hasSession: session !== null });
                  });
                }
                if (!observation.queryClient && exports?.queryClient?.getQueryCache)
                  observation.queryClient = exports.queryClient;
                return result;
              },
              ...registration,
            );
          };
        },
      });
      globalThis.__bf305Runtime = observation;
    },
    { origin: manifest.baseUrl },
  );
}

async function snapshot(page, user) {
  return page.evaluate(({ userId, businessId, clientName }) => {
    const runtime = globalThis.__bf305Runtime;
    if (!runtime?.client || !runtime?.queryClient)
      throw new Error('Runtime observation unavailable');
    const stored = JSON.parse(localStorage.getItem(runtime.client.auth.storageKey) || 'null');
    const privateQueries = runtime.queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => {
        if (query.state.data === undefined) return false;
        const text = JSON.stringify([query.queryKey, query.state.data]);
        return [userId, businessId, clientName].some((value) => text.includes(value));
      });
    // Only metadata leaves the browser; never Session, data, keys or credentials.
    return {
      persistedSession: stored !== null,
      sameUser: stored?.user?.id === userId,
      expiresAt: stored?.expires_at ?? null,
      privateQueryCount: privateQueries.length,
      signedOutEvents: runtime.events.filter((x) => x.event === 'SIGNED_OUT').length,
    };
  }, user);
}

module.exports = { observeRuntime, snapshot };

async function rememberQueries(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__bf305Runtime;
    runtime.remembered = runtime.queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.data !== undefined)
      .map((query) => ({ query, data: query.state.data }));
    return runtime.remembered.length;
  });
}

async function queriesPreserved(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__bf305Runtime;
    const current = runtime.queryClient.getQueryCache().getAll();
    return (
      runtime.remembered.length > 0 &&
      runtime.remembered.every(
        ({ query, data }) => current.includes(query) && query.state.data === data,
      )
    );
  });
}

module.exports.rememberQueries = rememberQueries;
module.exports.queriesPreserved = queriesPreserved;
