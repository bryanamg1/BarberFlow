const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const native = require('../../../scripts/e2e/android.cjs');
const { manifest, privateRoot } = require('../helpers/environment.cjs');

const env = {
  E2E_ENVIRONMENT_ID: manifest.environmentId,
  E2E_BASE_URL: manifest.baseUrl,
  E2E_ALLOW_DESTRUCTIVE_TESTS: 'true',
};
const sha = 'a'.repeat(40);
const configuration = () => ({
  android: { package: native.target.appId },
  slug: manifest.environmentId,
  scheme: 'barberflow',
  extra: { e2e: { environmentId: manifest.environmentId, sourceSha: sha } },
});
const facts = () => ({
  serial: native.target.serial,
  avd: `${native.target.avd}\nOK`,
  api: '36',
  abi: 'x86_64',
  boot: '1',
});

test('BF305 Android: approved debug configuration requires the exclusive E2E environment', () => {
  native.verifyConfiguration(configuration(), sha, env);
  for (const name of Object.keys(env))
    assert.throws(() => native.verifyConfiguration(configuration(), sha, { ...env, [name]: '' }));
});

for (const [name, change] of [
  [
    'production package',
    (c) => {
      c.android.package = 'dev.barberflow.production';
    },
  ],
  [
    'foreign project',
    (c) => {
      c.slug = 'barberflow';
    },
  ],
  [
    'wrong environment',
    (c) => {
      c.extra.e2e.environmentId = 'barberflow';
    },
  ],
  [
    'stale source',
    (c) => {
      c.extra.e2e.sourceSha = 'b'.repeat(40);
    },
  ],
  [
    'external EAS project',
    (c) => {
      c.extra.eas = { projectId: 'not-e2e' };
    },
  ],
  [
    'external owner',
    (c) => {
      c.owner = 'not-e2e';
    },
  ],
  [
    'wrong callback scheme',
    (c) => {
      c.scheme = 'different';
    },
  ],
])
  test(`BF305 Android: refuses ${name}`, () => {
    const c = configuration();
    change(c);
    assert.throws(() => native.verifyConfiguration(c, sha, env));
  });

test('BF305 Android: a native app environment override cannot choose another package', () => {
  assert.throws(() =>
    native.verifyConfiguration(configuration(), sha, {
      ...env,
      E2E_NATIVE_APP_ID: 'other.package',
    }),
  );
});

test('BF305 Android: device identity, boot, ABI and API must all match', () => {
  native.verifyDevice(facts());
  for (const [name, value] of [
    ['serial', 'usb-device'],
    ['avd', 'other\nOK'],
    ['boot', '0'],
    ['abi', 'arm64-v8a'],
    ['api', '35'],
  ]) {
    assert.throws(() => native.verifyDevice({ ...facts(), [name]: value }));
  }
});

test('BF305 Android: Windows adb CR/CRLF output preserves exact AVD identity', () => {
  for (const text of ['bf305_api36\nOK\n', 'bf305_api36\r\nOK\r\n', 'bf305_api36\r\r\nOK\r\r\n']) {
    native.verifyDevice({ ...facts(), avd: native.normalizeAdb(text) });
  }
  assert.throws(() =>
    native.verifyDevice({ ...facts(), avd: native.normalizeAdb('bf305_api36-extra\r\nOK') }),
  );
});

test('BF305 Android: Metro ignores inherited public/cloud configuration and dotenv', () => {
  const actual = native.metroEnvironment(
    'synthetic-local-key',
    { sdkRoot: 'portable-sdk' },
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://not-approved.invalid',
      EXPO_PUBLIC_OTHER_SECRET: 'not-allowed',
      EXPO_TOKEN: 'not-allowed',
      EAS_PROJECT_ID: 'not-allowed',
      Path: 'os-path',
    },
  );
  assert.equal(actual.EXPO_PUBLIC_SUPABASE_URL, manifest.supabaseUrl);
  assert.equal(actual.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'synthetic-local-key');
  assert.equal(actual.EXPO_PUBLIC_AUTH_RECOVERY_REDIRECT_URL, '');
  assert.equal(actual.EXPO_NO_DOTENV, '1');
  assert.equal(actual.EXPO_OFFLINE, '1');
  assert.equal(actual.EXPO_PUBLIC_OTHER_SECRET, undefined);
  assert.equal(actual.EXPO_TOKEN, undefined);
  assert.equal(actual.EAS_PROJECT_ID, undefined);
  assert.equal(actual.Path, 'os-path');
  for (const key of ['', 'bad\r\nheader']) assert.throws(() => native.metroEnvironment(key, {}));
});

test('BF305 Android: typed credentials are stdin only, with shell injection rejected', () => {
  const secret = 'Synthetic_native_password-123';
  const input = native.typedInput(secret);
  assert.ok(input.stdin.includes(secret));
  assert.ok(!input.args.some((arg) => arg.includes(secret)));
  assert.deepEqual(input.args, ['shell', '-T']);
  for (const value of ['', "a'b", 'a;id', 'a\nexit', '$(id)', 'a b', 'a&b'])
    assert.throws(() => native.typedInput(value));
});

test('BF305 Android: HTTP probe targets only isolated Auth with device-side CRLF decoding', () => {
  const input = native.probeInput('synthetic-local-key');
  assert.deepEqual(input.args, ['shell', '-T']);
  assert.ok(!input.stdin.includes('synthetic-local-key'));
  const encoded = input.stdin.match(/printf '%s' '([^']+)'/)[1];
  const request = Buffer.from(encoded, 'base64').toString();
  assert.equal(
    request,
    'GET /auth/v1/health HTTP/1.1\r\nHost: 127.0.0.1:55431\r\napikey: synthetic-local-key\r\nConnection: close\r\n\r\n',
  );
  assert.match(input.stdin, /sleep 3/);
  assert.match(input.stdin, /127\.0\.0\.1 55431/);
  assert.throws(() => native.probeInput('bad\nheader'));
});

test('BF305 Android: Maestro uses structured Java args, fixed target and private artifacts', () => {
  const tool = {
    javaHome: 'portable-java',
    maestro: path.join(privateRoot, 'toolchain/maestro/bin/maestro.bat'),
  };
  const flow = path.join(privateRoot, 'native-runs/unit/flow.yaml');
  const artifacts = path.join(privateRoot, 'native-runs/unit/output');
  const first = native.maestroInvocation(tool, flow, artifacts, false);
  const reused = native.maestroInvocation(tool, flow, artifacts, true);
  assert.equal(first.file, path.join('portable-java', 'bin/java.exe'));
  assert.equal(first.args[first.args.indexOf('--device') + 1], native.target.serial);
  assert.ok(first.args.includes('maestro.cli.AppKt'));
  assert.ok(!first.args.includes('--no-reinstall-driver'));
  assert.ok(reused.args.includes('--no-reinstall-driver'));
  assert.ok(!first.args.includes('--env') && !first.args.includes('-e'));
  for (const external of [
    path.join(privateRoot, '../outside.yaml'),
    path.join(privateRoot, '../outside-output'),
  ]) {
    assert.throws(() => native.maestroInvocation(tool, external, artifacts, false));
    assert.throws(() => native.maestroInvocation(tool, flow, external, false));
  }
});

test('BF305 Android: artifact guard detects UTF-8/UTF-16 credentials and token-shaped data', () => {
  const secret = 'synthetic-secret-12345';
  native.assertNoSecrets(Buffer.from('safe stage PASS'), [secret]);
  for (const encoding of ['utf8', 'utf16le'])
    assert.throws(() => native.assertNoSecrets(Buffer.from(`input ${secret}`, encoding), [secret]));
  assert.throws(() =>
    native.assertNoSecrets(Buffer.from('eyJmb28iOiJiYXIifQ.abcdefghijk.abcdefghijkl'), []),
  );
});

test('BF305 Android: foreground and private intents are package-scoped without startup waits or force-stop', () => {
  const component = `${native.target.appId}/.MainActivity`;
  const foreground = native.foregroundArgs(component);
  assert.equal(foreground[foreground.indexOf('-n') + 1], component);
  for (const invalid of [
    undefined,
    'other.package/.MainActivity',
    `${native.target.appId}/bad;command`,
    `${native.target.appId}/bad activity`,
  ])
    assert.throws(() => native.foregroundArgs(invalid));
  assert.ok(foreground.includes('android.intent.action.MAIN'));
  assert.ok(foreground.includes('android.intent.category.LAUNCHER'));
  const deepLink = native.protectedArgs();
  assert.equal(deepLink[deepLink.indexOf('-d') + 1], 'barberflow://clients');
  for (const args of [foreground, deepLink]) {
    assert.equal(args[args.indexOf('-p') + 1], native.target.appId);
    assert.ok(!args.includes('-W') && !args.includes('-S') && !args.includes('force-stop'));
  }
});
