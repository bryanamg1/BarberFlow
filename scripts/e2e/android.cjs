const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { guard, manifest, privateRoot } = require('../../tests/e2e/helpers/environment.cjs');

const target = Object.freeze({
  platform: 'android',
  appId: 'dev.barberflow.e2e.bf305',
  serial: 'emulator-5556',
  avd: 'bf305_api36',
  api: '36',
  abi: 'x86_64',
  metroPort: 8096,
  callback: 'barberflow://auth/recovery',
});

const normalizeAdb = (text) => text.replaceAll('\r', '').trim();

function verifyDevice(facts) {
  assert.deepEqual(
    facts,
    {
      serial: target.serial,
      avd: `${target.avd}\nOK`,
      api: target.api,
      abi: target.abi,
      boot: '1',
    },
    'Unapproved or unavailable Android target',
  );
}

function verifyConfiguration(config, sha, env = process.env) {
  guard(manifest, env);
  assert.equal(config.android?.package, target.appId);
  assert.equal(config.slug, manifest.environmentId);
  assert.equal(config.scheme, 'barberflow');
  assert.equal(config.extra?.e2e?.environmentId, manifest.environmentId);
  assert.equal(config.extra?.e2e?.sourceSha, sha);
  assert.equal(config.owner, undefined);
  assert.equal(config.extra?.eas, undefined);
  if (env.E2E_NATIVE_APP_ID !== undefined) assert.equal(env.E2E_NATIVE_APP_ID, target.appId);
}

function verifyTools(tool) {
  assert.equal(tool.serial, target.serial);
  assert.equal(tool.avd, target.avd);
  const portable = fs.realpathSync.native(path.join(privateRoot, 'toolchain')).toLowerCase();
  for (const field of ['javaHome', 'sdkRoot', 'adb', 'maestro']) {
    const resolved = fs.realpathSync.native(tool[field]).toLowerCase();
    assert.ok(resolved.startsWith(`${portable}${path.sep}`), 'Unapproved native tool path');
  }
}

function metroEnvironment(key, tool, inherited = process.env) {
  assert.ok(typeof key === 'string' && key.length > 0 && !/[\r\n]/.test(key));
  const env = { ...inherited };
  for (const name of Object.keys(env)) {
    if (/^(EXPO_PUBLIC_|EXPO_TOKEN$|EAS_)/.test(name)) delete env[name];
  }
  return {
    ...env,
    EXPO_NO_DOTENV: '1',
    EXPO_OFFLINE: '1',
    EXPO_NO_TELEMETRY: '1',
    CI: '1',
    EXPO_PUBLIC_SUPABASE_URL: manifest.supabaseUrl,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
    EXPO_PUBLIC_AUTH_RECOVERY_REDIRECT_URL: '',
    ANDROID_HOME: tool.sdkRoot,
  };
}

function typedInput(value) {
  assert.ok(typeof value === 'string' && /^[A-Za-z0-9@._-]+$/.test(value), 'Unsafe native input');
  // stdin only: never expose the credential in argv, YAML, environment or Maestro commands.
  return { args: ['shell', '-T'], stdin: `input text '${value}'\nexit\n` };
}

function probeInput(key) {
  assert.ok(typeof key === 'string' && key.length > 0 && !/[\r\n]/.test(key));
  const request = Buffer.from(
    `GET /auth/v1/health HTTP/1.1\r\nHost: 127.0.0.1:55431\r\napikey: ${key}\r\nConnection: close\r\n\r\n`,
  ).toString('base64');
  // Decode on Android: Windows adb normalizes stdin line endings. Keep stdin open until
  // the HTTP response arrives; netcat otherwise exits at EOF before reading the response.
  return {
    args: ['shell', '-T'],
    stdin: `{ printf '%s' '${request}' | toybox base64 -d; sleep 3; } | toybox nc -w 5 -W 5 127.0.0.1 55431\nexit\n`,
  };
}

function foregroundArgs(component) {
  assert.ok(
    typeof component === 'string' &&
      component.startsWith(`${target.appId}/`) &&
      /^[A-Za-z0-9_./]+$/.test(component),
    'Unapproved launcher component',
  );
  // -W waits for startup/drawn reporting, which can hang on an already-running activity.
  // The coordinator observes actual window focus and tenant UI instead.
  return [
    'shell',
    '-T',
    'am',
    'start',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.LAUNCHER',
    '-p',
    target.appId,
    '-n',
    component,
  ];
}

function protectedArgs() {
  return [
    'shell',
    '-T',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'barberflow://clients',
    '-p',
    target.appId,
  ];
}

function maestroInvocation(tool, flow, artifacts, reuseDriver) {
  for (const value of [flow, artifacts]) {
    assert.ok(
      path.resolve(value).startsWith(`${privateRoot}${path.sep}`),
      'Non-private native output',
    );
  }
  return {
    file: path.join(tool.javaHome, 'bin/java.exe'),
    args: [
      '--enable-native-access=ALL-UNNAMED',
      `-Duser.home=${path.join(privateRoot, 'maestro-home')}`,
      '-classpath',
      path.resolve(path.dirname(tool.maestro), '../lib/*'),
      'maestro.cli.AppKt',
      'test',
      '--device',
      target.serial,
      '--platform',
      target.platform,
      '--test-output-dir',
      artifacts,
      '--debug-output',
      artifacts,
      '--no-ansi',
      ...(reuseDriver ? ['--no-reinstall-driver'] : []),
      flow,
    ],
  };
}

function assertNoSecrets(bytes, secrets) {
  for (const secret of secrets) {
    assert.ok(
      !bytes.includes(Buffer.from(secret)) && !bytes.includes(Buffer.from(secret, 'utf16le')),
      'Native artifact contains a credential',
    );
  }
  assert.ok(
    !/eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(bytes.toString('utf8')),
    'Native artifact contains a token',
  );
}

module.exports = {
  target,
  normalizeAdb,
  verifyDevice,
  verifyConfiguration,
  verifyTools,
  metroEnvironment,
  typedInput,
  probeInput,
  foregroundArgs,
  protectedArgs,
  maestroInvocation,
  assertNoSecrets,
};
