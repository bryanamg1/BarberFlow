const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const {
  root,
  privateRoot,
  workdir,
  manifest,
  guard,
  accountGuard,
} = require('../../tests/e2e/helpers/environment.cjs');
const native = require('./android.cjs');
const local = require('./local.cjs');
const authControl = require('./auth-control.cjs');
const nativeAuth = require('./android-auth.cjs');
const { cleanup, stop } = require('./process.cjs');
const { sanitize } = require('../../tests/e2e/helpers/diagnostics.cjs');

const { target } = native;
const directory = path.join(
  privateRoot,
  'native-runs',
  `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
);
const app = path.join(privateRoot, 'app');
const canary = 'BF305NonCredentialCanary';
let tool, release, server, key, users, launcherComponent, authRuntime;
let stage = 'preflight';
let started = false,
  resetReady = false,
  installed = false,
  reversed = false;
let maestroReady = false;
let lastOperation = 'none';
let childFailure = null;
const results = [];
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function record(name, result) {
  results.push({ name, result });
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'results.json'),
    JSON.stringify({ stage, results }, null, 2),
  );
  process.stdout.write(`BF305 Android: ${name} ${result}\n`);
}

function command(file, args, input, timeout = 180000) {
  lastOperation = file === tool?.adb ? args.slice(2, 6).join(' ') : 'apk-badging';
  const result = spawnSync(file, args, {
    cwd: root,
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  // A subprocess error can contain stdin/credentials. Report the stage, never the raw error.
  if (result.status !== 0 || result.error) {
    childFailure = {
      operation: lastOperation,
      exitCode: result.status,
      signal: result.signal,
      code: result.error?.code || null,
    };
    throw new Error('Native subprocess failed');
  }
  return native.normalizeAdb(result.stdout);
}

function adb(args, input) {
  if (args[0] === 'shell' && args[1] !== '-T') args = ['shell', '-T', ...args.slice(1)];
  return command(tool.adb, ['-s', target.serial, ...args], input);
}

function verifyDevice() {
  native.verifyDevice({
    serial: tool.serial,
    avd: adb(['emu', 'avd', 'name']),
    api: adb(['shell', 'getprop', 'ro.build.version.sdk']),
    abi: adb(['shell', 'getprop', 'ro.product.cpu.abi']),
    boot: adb(['shell', 'getprop', 'sys.boot_completed']),
  });
}

function freePort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', () => reject(new Error('E2E port occupied')));
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}

async function wait(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error('Native observation deadline exceeded');
}

function inspectArtifacts(secrets) {
  for (const base of [directory, path.join(privateRoot, 'maestro-home')]) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(json|log|txt|xml|html|yaml)$/.test(entry.name)) {
        native.assertNoSecrets(fs.readFileSync(path.join(entry.parentPath, entry.name)), secrets);
      }
    }
  }
}

function maestro(name, text) {
  verifyDevice();
  assert.ok(text.startsWith(`appId: ${target.appId}\n`));
  assert.ok(!text.includes('inputText') && !text.includes('${'));
  const flow = path.join(directory, `${name}.yaml`);
  const artifacts = path.join(directory, name);
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(flow, text);
  const invocation = native.maestroInvocation(tool, flow, artifacts, maestroReady);
  const env = {
    ...process.env,
    JAVA_HOME: tool.javaHome,
    ANDROID_HOME: tool.sdkRoot,
    ANDROID_SDK_ROOT: tool.sdkRoot,
    ANDROID_USER_HOME: tool.androidUserHome,
    ANDROID_AVD_HOME: tool.avdHome,
    MAESTRO_CLI_NO_ANALYTICS: 'true',
    MAESTRO_DISABLE_UPDATE_CHECK: 'true',
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    Path: `${path.join(tool.javaHome, 'bin')};${path.dirname(tool.adb)};${process.env.Path || process.env.PATH}`,
  };
  delete env.PATH;
  for (const field of Object.keys(env))
    if (/^(EXPO_PUBLIC_|E2E_OWNER_|EXPO_TOKEN$|EAS_)/.test(field)) delete env[field];
  for (const field of [
    'E2E_ACCOUNTS',
    'JAVA_OPTS',
    'MAESTRO_OPTS',
    '_JAVA_OPTIONS',
    'JAVA_TOOL_OPTIONS',
  ])
    delete env[field];
  const result = spawnSync(invocation.file, invocation.args, {
    env,
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const secrets = [key, ...Object.values(users || {}).map((user) => user.password)].filter(Boolean);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  native.assertNoSecrets(Buffer.from(output), secrets);
  fs.writeFileSync(path.join(artifacts, 'cli.txt'), output);
  inspectArtifacts(secrets);
  if (result.status !== 0 || result.error) {
    childFailure = {
      operation: `maestro:${name}`,
      exitCode: result.status,
      signal: result.signal,
      code: result.error?.code || null,
    };
    throw new Error('Maestro phase failed');
  }
  maestroReady = true;
  record(name, 'PASS');
}

function flow(name, filename, values = {}) {
  let text = fs
    .readFileSync(path.join(root, '.maestro/bf305', filename), 'utf8')
    .replaceAll('\r', '');
  // Only synthetic, non-secret client sentinels are substituted in YAML.
  for (const [name, value] of Object.entries(values)) {
    assert.ok(['E2E_CLIENT_NAME', 'E2E_FOREIGN_CLIENT_NAME'].includes(name));
    assert.match(value, /^BF305 Client [AB]$/);
    text = text.replaceAll(`\${${name}}`, value);
  }
  maestro(name, text);
}

const yaml = (commands) => `appId: ${target.appId}\n---\n${commands}\n`;
async function backgroundPrimitives() {
  const focus = () =>
    adb(['shell', 'dumpsys', 'window'])
      .split('\n')
      .find((line) => line.includes('mCurrentFocus=')) || '';
  const home = adb([
    'shell',
    'cmd',
    'package',
    'resolve-activity',
    '--brief',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.HOME',
  ]);
  const homePackage = home.match(/^([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+$/m)?.[1];
  assert.ok(homePackage && homePackage !== target.appId);
  const before = adb(['shell', 'pidof', target.appId]);
  record('background-pid-observed', 'PASS');
  adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  await wait(() => focus().includes(`${homePackage}/`));
  record('background-home-command', 'PASS');
  adb(native.foregroundArgs(launcherComponent));
  await wait(() => focus().includes(`${target.appId}/`));
  record('foreground-start-command', 'PASS');
  const after = adb(['shell', 'pidof', target.appId]);
  assert.equal(after, before);
  record('foreground-process-preserved', 'PASS');
}
function type(value) {
  const input = native.typedInput(value);
  adb(input.args, input.stdin);
}
function sessionCount(user) {
  return local.sql(`SELECT count(*) FROM auth.sessions WHERE user_id='${user.userId}'`);
}
function clearApp() {
  verifyDevice();
  adb(['shell', 'am', 'force-stop', target.appId]);
  assert.match(adb(['shell', 'pm', 'clear', target.appId]), /Success/);
}

function verifySnapshot() {
  const config = readJson(path.join(app, 'app.json')).expo;
  native.verifyConfiguration(config, local.exec('git', ['rev-parse', 'HEAD']));
  assert.deepEqual(
    readJson(path.join(app, 'package.json')).dependencies,
    readJson(path.join(root, 'package.json')).dependencies,
  );
  for (const folder of ['src', 'assets']) {
    const files = (base) =>
      fs
        .readdirSync(base, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(base, path.join(entry.parentPath, entry.name)))
        .sort();
    const original = path.join(root, folder),
      snapshot = path.join(app, folder);
    assert.deepEqual(files(original), files(snapshot));
    for (const name of files(original))
      assert.ok(
        fs
          .readFileSync(path.join(original, name))
          .equals(fs.readFileSync(path.join(snapshot, name))),
      );
  }
  const apk = path.join(app, 'android/app/build/outputs/apk/debug/app-debug.apk');
  const badging = command(path.join(tool.sdkRoot, 'build-tools/36.0.0/aapt.exe'), [
    'dump',
    'badging',
    apk,
  ]);
  assert.match(badging, /package: name='dev\.barberflow\.e2e\.bf305'/);
  assert.match(badging, /application-debuggable/);
  const launcherClass = badging.match(/launchable-activity: name='([^']+)'/)?.[1];
  assert.ok(launcherClass?.startsWith(`${target.appId}.`));
  launcherComponent = `${target.appId}/${launcherClass}`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'build.json'),
    JSON.stringify(
      {
        appId: target.appId,
        launcherComponent,
        sha: config.extra.e2e.sourceSha,
        sha256: createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),
        backend: manifest.supabaseUrl,
        productionCredentials: false,
      },
      null,
      2,
    ),
  );
  return apk;
}

async function privacy() {
  const opening = fs
    .readFileSync(path.join(root, '.maestro/bf305/login.yaml'), 'utf8')
    .replaceAll('\r', '');
  maestro('privacy-focus', `${opening}\n- tapOn: Contraseña\n`);
  type(canary);
  // Let Android's temporary last-character reveal expire before artifact inspection.
  await new Promise((resolve) => setTimeout(resolve, 1800));
  let hierarchy;
  try {
    adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/bf305-canary.xml']);
    hierarchy = adb(['exec-out', 'cat', '/data/local/tmp/bf305-canary.xml']);
  } finally {
    adb(['shell', 'rm', '-f', '/data/local/tmp/bf305-canary.xml']);
  }
  assert.ok(!hierarchy.includes(canary));
  const node = hierarchy.match(/<node\b[^>]*password="true"[^>]*>/)?.[0];
  const masked = node?.match(/\btext="([^"]*)"/)?.[1];
  assert.equal(masked?.length, canary.length);
  assert.match(masked, /^[\u2022*]+$/);
  maestro(
    'privacy-artifacts',
    yaml(
      '- tapOn: Correo electrónico\n- assertVisible: Iniciar sesión\n- takeScreenshot: masked-canary',
    ),
  );
  inspectArtifacts([canary, key]);
  record('privacy', 'PASS');
}

async function login(name, user, launch = true) {
  accountGuard(user.email);
  if (launch) flow(`${name}-email-focus`, 'login.yaml');
  else
    maestro(
      `${name}-email-focus`,
      yaml('- assertVisible: Iniciar sesión\n- tapOn: Correo electrónico'),
    );
  type(user.email);
  flow(`${name}-password-focus`, 'password.yaml');
  type(user.password);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  flow(`${name}-submit`, 'submit.yaml');
  assert.equal(sessionCount(user), '1');
}
function tenant(name, user, foreign) {
  flow(name, 'tenant.yaml', {
    E2E_CLIENT_NAME: user.clientName,
    E2E_FOREIGN_CLIENT_NAME: foreign.clientName,
  });
}
async function logout(name, user) {
  flow(name, 'logout.yaml');
  await wait(() => sessionCount(user) === '0');
}

function checkoutResult(name, expected) {
  const checkout = require('./checkout.cjs');
  const actual = checkout.snapshot();
  // Preserve synthetic domain evidence before any assertion and before final reset.
  // This projection contains no Auth records, tokens, credentials or HTTP headers.
  fs.writeFileSync(path.join(directory, `${name}-observed.json`), JSON.stringify(actual, null, 2));
  const saleId = checkout.verify(actual, expected);
  const clientLabel = expected.linked ? users.a.clientId : 'Sin cliente';
  const saleLabel = `Venta: ${saleId}`;
  const money = (label, value) => `^${label}: ARS ${value.replace('.', ',')}$`;
  const scrollTo = (element, direction, centerElement = false) =>
    `- scrollUntilVisible:\n    element: '${element}'\n    direction: ${direction}\n    centerElement: ${centerElement}\n    timeout: 20000`;
  const total = money('Total', expected.net);
  const noMoneyFallback = "- assertNotVisible: '.*Importe no disponible.*'";
  maestro(
    `${name}-record`,
    yaml(
      [
        scrollTo(saleLabel, 'UP'),
        `- assertVisible: '${saleLabel}'`,
        '- assertVisible: Completada',
        `- assertVisible: 'Cliente: ${clientLabel}'`,
        `- assertVisible: '${total}'`,
        `- assertVisible: '${money('Subtotal', expected.gross)}'`,
        `- assertVisible: '${money('Descuento', expected.discount ?? '0.00')}'`,
        noMoneyFallback,
        ...actual.items.flatMap((item) => [
          scrollTo(saleLabel, 'UP'),
          scrollTo(item.item_name_snapshot, 'DOWN', true),
          `- assertVisible:\n    text: '${money('Precio unitario histórico', item.unit_price_snapshot)}'\n    below: '${item.item_name_snapshot}'`,
          `- assertVisible:\n    text: '${money('Importe registrado', item.line_total)}'\n    below: '${item.item_name_snapshot}'`,
          noMoneyFallback,
        ]),
        scrollTo(money('Importe del pago', expected.net), 'DOWN'),
        noMoneyFallback,
      ].join('\n'),
    ),
  );
  fs.writeFileSync(
    path.join(directory, `${name}-persistence.json`),
    JSON.stringify(
      {
        sourceSha: local.exec('git', ['rev-parse', 'HEAD']),
        saleId,
        expected,
        sales: actual.sales.length,
        items: actual.items.length,
        payments: actual.payments.length,
        stock: checkout.stock(),
        appointmentStatus: actual.appointment.status,
        result: 'PASS',
      },
      null,
      2,
    ),
  );
  record(`BF306-android-${name}-persisted-detail`, 'PASS');
  return saleId;
}

async function main() {
  guard();
  assert.ok(
    ['suite', 'canary', 'auth', 'checkout', 'insufficient-stock', 'appointment-lifecycle'].includes(
      process.argv[2] || 'suite',
    ),
  );
  assert.equal(process.env.E2E_AUTH_PROFILE, undefined);
  if (process.argv[2] === 'auth') process.env.E2E_AUTH_PROFILE = authControl.profile.name;
  native.verifyBranch(local.exec('git', ['branch', '--show-current']), process.argv[2] || 'suite');
  tool = readJson(path.join(privateRoot, 'native-toolchain.json'));
  native.verifyTools(tool);
  verifyDevice();
  await freePort(8095);
  await freePort(target.metroPort);
  release = local.acquire();
  const apk = verifySnapshot();
  record('build-attestation', 'PASS');
  stage = 'stack-start';
  local.prepare();
  started = true;
  local.cli([
    'start',
    '--workdir',
    workdir,
    '--exclude',
    'studio,imgproxy,logflare,vector,supavisor,edge-runtime,realtime',
  ]);
  local.verifyContainer();
  if (process.argv[2] === 'auth')
    authControl.observeContainer(local, authControl.profile.jwtExpiry);
  stage = 'reset';
  local.fullReset();
  resetReady = true;
  record('baseline', 'PASS');
  key = local.publicKey();
  stage = 'connectivity';
  const mappings = adb(['reverse', '--list']);
  assert.ok(!mappings.includes('tcp:55431') && !mappings.includes(`tcp:${target.metroPort}`));
  adb(['reverse', 'tcp:55431', 'tcp:55431']);
  reversed = true;
  adb(['reverse', `tcp:${target.metroPort}`, `tcp:${target.metroPort}`]);
  const probe = native.probeInput(key),
    response = adb(probe.args, probe.stdin);
  assert.match(response, /HTTP\/1\.1 200/);
  assert.match(response, /GoTrue/);
  record('device-backend', 'PASS');
  stage = 'metro';
  server = {
    process: spawn(
      process.execPath,
      [
        '--dns-result-order=ipv4first',
        path.join(root, 'node_modules/expo/bin/cli'),
        'start',
        app,
        '--localhost',
        '--port',
        String(target.metroPort),
      ],
      {
        cwd: root,
        env: native.metroEnvironment(key, tool),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    ),
  };
  server.process.once('error', () => {
    server.spawnError = true;
  });
  const logs = [];
  for (const stream of [server.process.stdout, server.process.stderr])
    stream.on('data', (chunk) => {
      logs.push(sanitize(chunk.toString(), [key]));
      if (logs.length > 40) logs.shift();
    });
  server.logs = logs;
  await wait(async () => {
    if (server.spawnError) throw new Error('Native Metro spawn failed');
    try {
      const r = await fetch(`http://127.0.0.1:${target.metroPort}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      return r.ok && (await r.text()).includes('packager-status:running');
    } catch {
      return false;
    }
  }, 180000);
  record('metro', 'PASS');
  stage = 'install';
  adb(['install', '-r', apk]);
  installed = true;
  clearApp();
  stage = 'privacy';
  await privacy();
  if (process.argv[2] === 'canary') {
    if (process.env.E2E_NATIVE_DIAGNOSE_BACKGROUND === '1') {
      stage = 'public-background-diagnostic';
      await backgroundPrimitives();
      maestro('public-foreground', yaml('- assertVisible: Iniciar sesión'));
      record('public-background-diagnostic', 'PASS');
    }
    return;
  }
  stage = 'fixtures';
  users = local.accounts({ withBarber: process.argv[2] === 'appointment-lifecycle' });
  local.seed(users);
  assert.equal(sessionCount(users.a), '0');
  assert.equal(sessionCount(users.b), '0');
  clearApp();
  record('native-pre-run-reset', 'PASS');
  if (process.argv[2] === 'appointment-lifecycle') {
    const lifecycle = require('./appointment-lifecycle.cjs');
    const scenario = (name) =>
      maestro(
        `bf304a-${name}`,
        fs
          .readFileSync(path.join(root, `.maestro/bf304a/${name}.yaml`), 'utf8')
          .replaceAll('\r', ''),
      );
    stage = 'appointment-lifecycle-fixtures';
    lifecycle.seed(users);
    const day = lifecycle.today();
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    stage = 'appointment-lifecycle-login';
    await login('bf304a-owner', users.a);
    stage = 'appointment-lifecycle-create';
    scenario('select');
    type(day);
    scenario('create');
    const created = lifecycle.createdAppointment();
    const expected = {
      client_id: users.a.clientId,
      barber_member_id: users.barber.memberId,
      start_at: `${day}T12:00:00+00:00`,
      end_at: `${day}T12:30:00+00:00`,
      status: 'PENDING',
      service: lifecycle.fixtures.service,
      name: lifecycle.names.service,
      price: '12.50',
    };
    lifecycle.assertAppointment(created, expected);
    record('bf304a-create-persistence', 'PASS');
    stage = 'appointment-lifecycle-reschedule';
    scenario('reschedule');
    const updated = lifecycle.createdAppointment();
    lifecycle.assertAppointment(updated, {
      ...expected,
      start_at: `${day}T13:00:00+00:00`,
      end_at: `${day}T13:30:00+00:00`,
    });
    assert.equal(updated.id, created.id);
    assert.deepEqual(updated.items, created.items);
    record('bf304a-reschedule-persistence', 'PASS');
    stage = 'appointment-lifecycle-terminal';
    scenario('cancel');
    const terminal = lifecycle.createdAppointment();
    assert.deepEqual(terminal, {
      ...updated,
      status: 'CANCELLED',
      updated_at: terminal.updated_at,
    });
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `barberflow://appointments/${terminal.id}/edit`,
      '-p',
      target.appId,
    ]);
    scenario('terminal');
    assert.deepEqual(lifecycle.createdAppointment(), terminal);
    assert.deepEqual(lifecycle.counts(), { clients: 1, services: 1, appointments: 3, sales: 0 });
    record('bf304a-terminal-persistence', 'PASS');
    return;
  }
  if (process.argv[2] === 'insufficient-stock') {
    const checkout = require('./checkout.cjs');
    const stock = require('./insufficient-stock.cjs');
    const scenario = (name) =>
      maestro(
        `bf308-${name}`,
        fs
          .readFileSync(path.join(root, `.maestro/bf308/${name}.yaml`), 'utf8')
          .replaceAll('\r', ''),
      );
    function replaceQuantity(value) {
      adb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
      adb(['shell', 'input', 'keyevent', 'KEYCODE_DEL']);
      type(value);
    }
    stage = 'insufficient-stock-fixtures';
    stock.seed(users);
    stock.baseline();
    const other = checkout.snapshot('b');
    stock.adjustNative(1, 'prepare');
    stage = 'insufficient-stock-login';
    await login('bf308-owner', users.a);
    stage = 'insufficient-stock-stale-cart';
    scenario('prepare');
    replaceQuantity('2');
    scenario('review');
    stock.adjustNative(-1, 'stale');
    const before = checkout.snapshot();
    stock.assertLedger(before.movements, 1);
    stage = 'insufficient-stock-rejection';
    scenario('reject');
    stock.rejected(before, checkout.snapshot(), 1);
    record('bf308-rejection-no-partial-writes', 'PASS');
    stage = 'insufficient-stock-recovery';
    scenario('edit');
    replaceQuantity('1');
    scenario('recover');
    const saleId = stock.soldOne(before, checkout.snapshot());
    maestro(
      'bf308-recovered-record',
      yaml(
        `- assertVisible: 'Venta: ${saleId}'\n- assertVisible: 'Total: ARS 10,02'\n- scrollUntilVisible:\n    element: 'Importe del pago: ARS 10,02'\n    direction: DOWN\n    timeout: 20000\n- assertNotVisible: '.*Importe no disponible.*'`,
      ),
    );
    stock.rejected(other, checkout.snapshot('b'), 1);
    record('bf308-recovery-one-sale-one-payment-one-debit', 'PASS');
    return;
  }
  if (process.argv[2] === 'checkout') {
    const checkout = require('./checkout.cjs');
    stage = 'checkout-fixtures';
    checkout.seed(users);
    record('checkout-stock-and-session-baseline', 'PASS');
    stage = 'checkout-login';
    await login('checkout-owner', users.a);
    stage = 'checkout-ui';
    maestro(
      'checkout',
      fs.readFileSync(path.join(root, '.maestro/bf306/checkout.yaml'), 'utf8').replaceAll('\r', ''),
    );
    stage = 'checkout-persistence';
    const expected = {
      gross: '15.01',
      net: '15.01',
      items: [{ type: 'SERVICE', quantity: 1, price: '15.01' }],
    };
    const saleId = checkoutResult('checkout', expected);
    stage = 'checkout-back';
    maestro(
      'checkout-back',
      yaml('- back\n- assertNotVisible: Detalle de venta\n- assertNotVisible: Completar venta'),
    );
    assert.equal(checkout.verify(checkout.snapshot(), expected), saleId);
    record('BF306-android-checkout-back-no-duplicate', 'PASS');
    stage = 'checkout-logout';
    await logout('checkout-logout', users.a);
    stage = 'checkout-linked-reset';
    clearApp();
    checkout.reset(users, { servicePrice: '10.02' });
    record('checkout-linked-stock-and-session-baseline', 'PASS');
    stage = 'checkout-linked-login';
    await login('checkout-linked-owner', users.a);
    stage = 'checkout-linked-ui';
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `barberflow://appointments/${checkout.fixture().appointmentId}`,
      '-p',
      target.appId,
    ]);
    maestro(
      'checkout-linked',
      fs
        .readFileSync(path.join(root, '.maestro/bf306/appointment-checkout.yaml'), 'utf8')
        .replaceAll('\r', ''),
    );
    const discount = '0.01';
    adb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
    adb(['shell', 'input', 'keyevent', ...Array(4).fill('KEYCODE_DEL')]);
    type(discount);
    maestro(
      'checkout-linked-submit',
      fs
        .readFileSync(path.join(root, '.maestro/bf306/appointment-checkout-submit.yaml'), 'utf8')
        .replaceAll('\r', ''),
    );
    stage = 'checkout-linked-persistence';
    checkoutResult('checkout-linked', {
      gross: '20.04',
      net: '20.03',
      discount,
      linked: true,
      items: [
        { type: 'SERVICE', quantity: 1, price: '10.02' },
        { type: 'PRODUCT', quantity: 1, price: '10.02' },
      ],
    });
    return;
  }
  if (process.argv[2] === 'auth') {
    stage = 'auth-refresh-success';
    await login('auth-a', users.a);
    tenant('auth-tenant-a', users.a, users.b);
    const authPid = adb(['shell', 'pidof', target.appId]);
    authRuntime = await nativeAuth.connect();
    await nativeAuth.observe(authRuntime);
    const before = await nativeAuth.snapshot(authRuntime, users.a);
    assert.ok(before.sameUser && before.privateQueryCount > 0);
    const refreshed = await authRuntime.evaluate(`(async () => {
      const runtime = globalThis.__bf305Lifecycle;
      const remembered = runtime.queryClient.getQueryCache().getAll()
        .filter(query => query.state.data !== undefined).map(query => ({ query, data: query.state.data }));
      const { data, error } = await runtime.client.auth.refreshSession();
      const current = runtime.queryClient.getQueryCache().getAll();
      return { success: !error && !!data.session, preserved: remembered.length > 0 &&
        remembered.every(({ query, data }) => current.includes(query) && query.state.data === data) };
    })()`);
    assert.deepEqual(refreshed, { success: true, preserved: true });
    const afterRefresh = await nativeAuth.snapshot(authRuntime, users.a);
    assert.ok(afterRefresh.sameUser);
    assert.equal(afterRefresh.signedOutEvents, before.signedOutEvents);
    record('auth-refresh-success-cache-preserved', 'PASS');
    stage = 'auth-expired-rejection';
    await authRuntime.evaluate(
      '(() => { globalThis.__bf305Lifecycle.client.auth.stopAutoRefresh(); return true; })()',
    );
    const expiry = (await nativeAuth.snapshot(authRuntime, users.a)).expiresAt;
    assert.ok(Number.isInteger(expiry) && expiry * 1000 - Date.now() <= 21000);
    local.softReset({ a: users.a });
    await wait(() => Date.now() >= expiry * 1000 + 250, 25000);
    const rejection = await authRuntime.evaluate(`(async () => {
      const { data, error } = await globalThis.__bf305Lifecycle.client.auth.refreshSession();
      return { rejected: !!error, hasSession: !!data.session, code: error?.code };
    })()`);
    assert.deepEqual(rejection, {
      rejected: true,
      hasSession: false,
      code: 'refresh_token_not_found',
    });
    authRuntime.close();
    authRuntime = undefined;
    maestro(
      'auth-expired-login',
      yaml(
        '- assertVisible: Iniciar sesión\n- assertNotVisible: BF305 Client A\n- assertNotVisible: BF305 Client B',
      ),
    );
    authRuntime = await nativeAuth.connect();
    const expired = await nativeAuth.snapshot(authRuntime, users.a);
    assert.equal(expired.persistedSession, false);
    assert.equal(expired.privateQueryCount, 0);
    assert.ok(expired.signedOutEvents > 0);
    authRuntime.close();
    authRuntime = undefined;
    adb(native.protectedArgs());
    flow('auth-protected-expired', 'protected.yaml');
    fs.writeFileSync(
      path.join(directory, 'auth-observation.json'),
      JSON.stringify({ before, afterRefresh, expired, rejection }, null, 2),
    );
    record('auth-expired-rejection-cache-zero', 'PASS');
    stage = 'auth-smoke-b';
    await login('auth-smoke-b', users.b, false);
    tenant('auth-smoke-tenant-b', users.b, users.a);
    assert.equal(adb(['shell', 'pidof', target.appId]), authPid);
    authRuntime = await nativeAuth.connect();
    assert.equal((await nativeAuth.snapshot(authRuntime, users.a)).privateQueryCount, 0);
    authRuntime.close();
    authRuntime = undefined;
    await logout('auth-smoke-logout', users.b);
    authRuntime = await nativeAuth.connect();
    assert.equal((await nativeAuth.snapshot(authRuntime, users.b)).privateQueryCount, 0);
    record('auth-smoke-login-logout-cache-zero', 'PASS');
    return;
  }
  stage = 'smoke';
  await login('smoke-a', users.a);
  tenant('smoke-tenant-a', users.a, users.b);
  await logout('smoke-logout', users.a);
  record('smoke', 'PASS');
  stage = 'persistence';
  await login('persistence-a', users.a);
  tenant('before-relaunch', users.a, users.b);
  const coldPid = adb(['shell', 'pidof', target.appId]);
  adb(['shell', 'am', 'force-stop', target.appId]);
  flow('cold-relaunch', 'persistence.yaml');
  assert.notEqual(adb(['shell', 'pidof', target.appId]), coldPid);
  assert.equal(sessionCount(users.a), '1');
  tenant('restored-tenant-a', users.a, users.b);
  record('persistence', 'PASS');
  stage = 'background-foreground';
  await backgroundPrimitives();
  tenant('foreground-tenant-a', users.a, users.b);
  assert.equal(sessionCount(users.a), '1');
  record('background-foreground', 'PASS');
  stage = 'logout-back';
  await logout('logout-before-back', users.a);
  flow('android-back', 'back.yaml');
  record('logout-back', 'PASS');
  stage = 'tenant-isolation';
  await login('tenant-b', users.b);
  tenant('tenant-b-isolation', users.b, users.a);
  assert.equal(sessionCount(users.a), '0');
  assert.equal(sessionCount(users.b), '1');
  record('tenant-isolation', 'PASS');
  await logout('tenant-b-logout', users.b);
  stage = 'protected-navigation';
  adb(native.protectedArgs());
  flow('protected-clients', 'protected.yaml');
  assert.equal(sessionCount(users.b), '0');
  record('protected-navigation', 'PASS');
  inspectArtifacts([key, canary, users.a.password, users.b.password]);
  record('artifact-security', 'PASS');
}

main()
  .catch((error) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'failure-location.json'),
      JSON.stringify(
        {
          stage,
          operation: lastOperation,
          childFailure,
          errorType: error?.name,
          locations: String(error?.stack || '')
            .split('\n')
            .filter((line) => /^\s+at /.test(line))
            .slice(0, 4)
            .map((line) => line.replaceAll(root, '<workspace>')),
        },
        null,
        2,
      ),
    );
    record(stage, 'FAIL');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup([
        ['inspector-close', () => authRuntime?.close()],
        [
          'app-clear',
          () => {
            if (installed) clearApp();
          },
        ],
        [
          'maestro-driver-stop',
          () => {
            if (installed) {
              verifyDevice();
              adb(['shell', 'am', 'force-stop', 'dev.mobile.maestro']);
              adb(['shell', 'am', 'force-stop', 'dev.mobile.maestro.test']);
              const forwards = adb(['forward', '--list']);
              if (
                forwards.split('\n').some((line) => line === `${target.serial} tcp:7001 tcp:7001`)
              )
                adb(['forward', '--remove', 'tcp:7001']);
            }
          },
        ],
        ['metro-stop', () => stop(server)],
        [
          'metro-diagnostic',
          () => {
            if (server)
              fs.writeFileSync(
                path.join(directory, 'metro.json'),
                JSON.stringify(
                  {
                    exitCode: server.process.exitCode,
                    signalCode: server.process.signalCode,
                    logs: server.logs,
                  },
                  null,
                  2,
                ),
              );
          },
        ],
        [
          'backend-reset',
          () => {
            if (resetReady) local.fullReset();
          },
        ],
        [
          'stack-stop',
          () => {
            if (started) local.cli(['stop', '--workdir', workdir]);
          },
        ],
        [
          'auth-config-restore',
          () => {
            if (process.argv[2] !== 'auth' || !release) return;
            delete process.env.E2E_AUTH_PROFILE;
            local.prepare();
            if (!started) return;
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
        [
          'reverse-remove',
          () => {
            if (reversed) {
              verifyDevice();
              adb(['reverse', '--remove', 'tcp:55431']);
              adb(['reverse', '--remove', `tcp:${target.metroPort}`]);
            }
          },
        ],
        ['port-release', () => freePort(target.metroPort)],
        [
          'artifact-security',
          () =>
            inspectArtifacts(
              [key, ...Object.values(users || {}).map((user) => user.password)].filter(Boolean),
            ),
        ],
      ]);
      record('cleanup', 'PASS');
    } catch (error) {
      const allowed = [
        'inspector-close',
        'auth-config-restore',
        'app-clear',
        'maestro-driver-stop',
        'metro-stop',
        'metro-diagnostic',
        'backend-reset',
        'stack-stop',
        'reverse-remove',
        'port-release',
        'artifact-security',
      ];
      const names = String(error?.message || '')
        .replace(/^E2E cleanup failed: /, '')
        .split(', ')
        .filter((name) => allowed.includes(name));
      fs.writeFileSync(
        path.join(directory, 'cleanup-failures.json'),
        JSON.stringify({ steps: names.length ? names : ['unknown'] }, null, 2),
      );
      record('cleanup', 'FAIL');
      process.exitCode = 1;
    } finally {
      if (release) release();
    }
  });
