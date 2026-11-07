const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { guard, root, privateRoot, manifest } = require('../../tests/e2e/helpers/environment.cjs');
const { target, verifyBranch } = require('./android.cjs');
const local = require('./local.cjs');
const { sanitize } = require('../../tests/e2e/helpers/diagnostics.cjs');

function prepare() {
  guard();
  verifyBranch(local.exec('git', ['branch', '--show-current']), 'prepare');
  const sha = local.exec('git', ['rev-parse', 'HEAD']);
  const app = path.join(privateRoot, 'app');
  if (fs.existsSync(app)) {
    assert.ok(!fs.lstatSync(app).isSymbolicLink());
    const previous = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8'));
    assert.equal(previous.expo.extra?.e2e?.environmentId, manifest.environmentId);
    // Archive only the test-owned snapshot. Never delete or move a product directory.
    const archive = path.resolve(privateRoot, 'build-archives', randomUUID());
    assert.ok(
      fs.realpathSync.native(app).startsWith(`${fs.realpathSync.native(privateRoot)}${path.sep}`),
    );
    assert.ok(archive.startsWith(`${path.resolve(privateRoot)}${path.sep}`));
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.renameSync(app, archive);
  }
  fs.mkdirSync(app, { recursive: true });
  for (const folder of ['src', 'assets'])
    fs.cpSync(path.join(root, folder), path.join(app, folder), { recursive: true });
  for (const file of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'babel.config.js',
    'metro.config.js',
  ]) {
    if (fs.existsSync(path.join(root, file)))
      fs.copyFileSync(path.join(root, file), path.join(app, file));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  config.expo.name = 'BarberFlow E2E';
  config.expo.slug = manifest.environmentId;
  config.expo.android = { ...config.expo.android, package: target.appId };
  delete config.expo.owner;
  config.expo.extra = {
    ...config.expo.extra,
    e2e: { environmentId: manifest.environmentId, sourceSha: sha },
  };
  delete config.expo.extra.eas;
  fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify(config, null, 2));
  const env = {
    ...process.env,
    EXPO_NO_DOTENV: '1',
    EXPO_OFFLINE: '1',
    EXPO_NO_TELEMETRY: '1',
    CI: '1',
  };
  for (const name of Object.keys(env))
    if (/^(EXPO_PUBLIC_|EXPO_TOKEN$|EAS_)/.test(name)) delete env[name];
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/expo/bin/cli'),
      'prebuild',
      app,
      '--platform',
      'android',
      '--no-install',
      '--template',
      path.join(root, 'node_modules/expo/template.tgz'),
      '--skip-dependency-update',
      'react,react-native',
    ],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  fs.writeFileSync(
    path.join(privateRoot, 'prebuild.log'),
    `${result.stdout || ''}\n${result.stderr || ''}`
      .split('\n')
      .map((line) => sanitize(line))
      .join('\n'),
  );
  assert.equal(result.status, 0, 'E2E prebuild failed; inspect private sanitized diagnostics');
  fs.writeFileSync(
    path.join(privateRoot, 'native-build-plan.json'),
    JSON.stringify(
      {
        sourceSha: sha,
        appId: target.appId,
        variant: 'debug',
        architecture: target.abi,
        nativeMetro: target.metroPort,
        backend: manifest.supabaseUrl,
        productionCredentials: false,
      },
      null,
      2,
    ),
  );
  process.stdout.write('BF305 Android: private CNG snapshot prepared\n');
}

if (require.main === module) {
  try {
    prepare();
  } catch {
    process.stderr.write('BF305 Android: preparation refused or failed\n');
    process.exitCode = 1;
  }
}
module.exports = { prepare };
