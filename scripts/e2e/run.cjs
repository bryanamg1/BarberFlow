const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  manifest,
  root,
  workdir,
  privateRoot,
  guard,
} = require('../../tests/e2e/helpers/environment.cjs');
const local = require('./local.cjs');
const { stop, terminated, cleanup } = require('./process.cjs');
const { webCommand, webSpec } = require('./web.cjs');
const { record } = require('../../tests/e2e/helpers/evidence.cjs');
const { sanitize, writeDiagnostic } = require('../../tests/e2e/helpers/diagnostics.cjs');

function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('E2E port is already occupied')));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function waitFor(check, milliseconds = 180000) {
  const deadline = Date.now() + milliseconds;
  return new Promise((resolve, reject) => {
    async function observe() {
      try {
        if (await check()) return resolve();
      } catch {
        /* The next health observation may succeed before the bounded deadline. */
      }
      if (Date.now() >= deadline) return reject(new Error('E2E health check deadline exceeded'));
      setTimeout(observe, 250);
    }
    void observe();
  });
}

function child(file, args, env) {
  const process = spawn(file, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  // Do not forward Expo output: it can print environment values or callback URLs.
  process.stdout.resume();
  process.stderr.resume();
  const diagnostics = new Set();
  const logs = { stdout: [], stderr: [] };
  const secrets = [env.EXPO_PUBLIC_SUPABASE_ANON_KEY];
  for (const [name, stream] of [
    ['stdout', process.stdout],
    ['stderr', process.stderr],
  ]) {
    let pending = '';
    stream.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      logs[name].push(...lines.map((line) => sanitize(line, secrets)));
      logs[name] = logs[name].slice(-40);
      for (const code of [
        'EPERM',
        'ENOENT',
        'EADDRINUSE',
        'ECONNREFUSED',
        'CommandError',
        'SyntaxError',
      ]) {
        if (chunk.toString().includes(code)) diagnostics.add(code);
      }
    });
  }
  const exit = new Promise((resolve) => {
    process.once('error', () => resolve(1));
    process.once('exit', (code) => resolve(code ?? 1));
  });
  return { process, exit, diagnostics, logs, command: [file, ...args], secrets };
}

async function main() {
  guard();
  const mode = process.argv[2];
  assert.ok(
    [
      'preflight',
      'reset',
      'server',
      'failure',
      'smoke',
      'owner-b',
      'web',
      'auth',
      'checkout',
      'insufficient-stock',
      'appointment-lifecycle',
      'purchase',
    ].includes(mode),
    'Unknown E2E command',
  );
  const authControl = require('./auth-control.cjs');
  if (mode === 'auth') {
    assert.equal(process.env.E2E_AUTH_PROFILE, undefined);
    process.env.E2E_AUTH_PROFILE = authControl.profile.name;
  } else {
    assert.equal(process.env.E2E_AUTH_PROFILE, undefined, 'Auth profile requires auth mode');
  }
  const release = local.acquire();
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(privateRoot, 'runs', runId);
  const sha = local.exec('git', ['rev-parse', 'HEAD']);
  let server;
  let started = false;
  let resetReady = false;
  let stage = 'preflight';
  let failed = false;
  const event = (name, result, cleanup) =>
    record(directory, name, { runId, sha, stage, result, cleanup });
  try {
    local.prepare();
    event('preflight', 'PASS');
    if (mode === 'preflight') return;
    stage = 'startup';
    process.stdout.write('BF305: starting exclusive local stack\n');
    started = true;
    local.cli([
      'start',
      '--workdir',
      workdir,
      '--exclude',
      'studio,imgproxy,logflare,vector,supavisor,edge-runtime,realtime',
    ]);
    local.verifyContainer();
    if (mode === 'auth') authControl.observeContainer(local, authControl.profile.jwtExpiry);
    event('isolation', 'PASS');
    stage = 'full-reset';
    local.fullReset();
    resetReady = true;
    event('baseline', 'PASS');
    if (mode === 'reset') return;
    stage = 'fixtures';
    const users = local.accounts({
      withBarber: ['appointment-lifecycle', 'purchase'].includes(mode),
    });
    local.seed(users);
    local.seed(users); // Re-preparation must reconcile without duplicate identities or memberships.
    if (mode === 'checkout') require('./checkout.cjs').seed(users);
    if (mode === 'insufficient-stock') require('./insufficient-stock.cjs').seed(users);
    if (mode === 'appointment-lifecycle') require('./appointment-lifecycle.cjs').seed(users);
    if (mode === 'purchase') require('./purchase.cjs').seed(users);
    event('fixtures', 'PASS');
    const key = local.publicKey();
    stage = 'backend-health';
    const authHealth = await fetch(`${manifest.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(authHealth.ok, true, 'Local Auth health failed');
    const restHealth = await fetch(`${manifest.supabaseUrl}/rest/v1/`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(restHealth.ok, true, 'Local API health failed');
    event('backend-health', 'PASS');
    await freePort(8095);
    const appEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) =>
        /^(path|systemroot|windir|comspec|temp|tmp|userprofile|appdata|localappdata|homedrive|homepath|pathext|number_of_processors)$/i.test(
          name,
        ),
      ),
    );
    Object.assign(appEnv, {
      EXPO_NO_DOTENV: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_OFFLINE: '1',
      BROWSER: 'none',
      CI: '1',
      E2E_ENVIRONMENT_ID: manifest.environmentId,
      EXPO_PUBLIC_SUPABASE_URL: manifest.supabaseUrl,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
      EXPO_PUBLIC_AUTH_RECOVERY_REDIRECT_URL: manifest.authCallback,
    });
    stage = 'web-startup';
    if (mode === 'failure') {
      server = child(process.execPath, ['-e', 'process.exit(2)'], appEnv);
      await server.exit;
      assert.fail('Simulated server failure before health');
    }
    const launch = webCommand();
    server = child(launch.file, launch.args, appEnv);
    await waitFor(async () => {
      if (terminated(server.process)) return true;
      const response = await fetch(manifest.baseUrl, { signal: AbortSignal.timeout(2000) });
      return response.ok;
    });
    if (terminated(server.process)) {
      process.stdout.write(`BF305: Web process exited; ${[...server.diagnostics].join(' ')}\n`);
      throw new Error('Web target exited');
    }
    event('web-target', 'PASS');
    if (mode === 'server') return;
    stage = 'web-tests';
    const runner = child(
      process.execPath,
      [
        path.join(root, 'node_modules/playwright/cli.js'),
        'test',
        '--config',
        path.join(root, 'tests/e2e/playwright.config.cjs'),
        webSpec(mode),
        ...(mode === 'owner-b' ? ['--grep', 'BF305-06'] : []),
      ],
      {
        ...appEnv,
        E2E_ENVIRONMENT_ID: manifest.environmentId,
        E2E_BASE_URL: manifest.baseUrl,
        E2E_ALLOW_DESTRUCTIVE_TESTS: 'true',
        E2E_RUN_ID: runId,
        E2E_GIT_SHA: sha,
        E2E_RUN_DIRECTORY: directory,
        E2E_ACCOUNTS: JSON.stringify(users),
        ...(mode === 'auth' ? { E2E_AUTH_PROFILE: authControl.profile.name } : {}),
      },
    );
    // Reporter output is allowlisted; expose case IDs/status only.
    runner.process.stdout.removeAllListeners('data');
    runner.process.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (/^BF30(?:4A|[5678])-\d+: (passed|failed|timedOut|interrupted|skipped)$/.test(line))
          process.stdout.write(`${line}\n`);
      }
    });
    assert.equal(await runner.exit, 0, 'BF305 Web did not pass; inspect private case results');
    event('web-suite', 'PASS');
    await stop(server);
    server = undefined;
    stage = 'soft-reset';
    local.softReset(users);
    event('soft-reset', 'PASS');
  } catch {
    failed = true;
    event('failure', 'FAIL');
    process.stdout.write(`BF305: FAIL at ${stage}; no raw child output persisted\n`);
  } finally {
    try {
      stage = 'cleanup';
      await cleanup([
        ['web-stop', () => stop(server)],
        [
          'web-diagnostic',
          () => {
            if (server)
              writeDiagnostic(
                directory,
                {
                  command: server.command,
                  exitCode: server.process.exitCode,
                  signalCode: server.process.signalCode,
                  ...server.logs,
                },
                server.secrets,
              );
          },
        ],
        [
          'full-reset',
          () => {
            if (!resetReady) return;
            local.fullReset();
            if (mode === 'purchase') require('./purchase.cjs').verifyReset();
          },
        ],
        [
          'stack-stop',
          () => {
            if (started) local.cli(['stop', '--workdir', workdir]);
          },
        ],
        ['port-release', () => freePort(8095)],
        [
          'auth-config-restore',
          () => {
            if (mode !== 'auth') return;
            delete process.env.E2E_AUTH_PROFILE;
            local.prepare();
            if (!started) return;
            // Verify the actual restored Auth process as well as the generated config file.
            try {
              local.cli([
                'start',
                '--workdir',
                workdir,
                '--exclude',
                'studio,imgproxy,logflare,vector,supavisor,edge-runtime,realtime',
              ]);
              authControl.observeContainer(local, 3600);
              local.baseline();
            } finally {
              local.cli(['stop', '--workdir', workdir]);
            }
          },
        ],
      ]);
      event('cleanup', 'PASS', 'PASS');
    } catch {
      failed = true;
      event('cleanup', 'FAIL', 'FAIL');
      process.stdout.write('BF305: cleanup failed; environment must not be reused\n');
    } finally {
      release();
      if (failed) process.exitCode = 1;
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(() => {
  process.stderr.write('BF305: preflight or exclusivity refused\n');
  process.exitCode = 1;
});
