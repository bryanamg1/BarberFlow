const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  guard,
  manifest,
  accountGuard,
  resetArguments,
  privateRoot,
} = require('./e2e/helpers/environment.cjs');
const { record } = require('./e2e/helpers/evidence.cjs');
const { id, accounts } = require('../scripts/e2e/local.cjs');
const { sanitize, redactTestError } = require('./e2e/helpers/diagnostics.cjs');
const approved = {
  E2E_ENVIRONMENT_ID: manifest.environmentId,
  E2E_BASE_URL: manifest.baseUrl,
  E2E_ALLOW_DESTRUCTIVE_TESTS: 'true',
};

test('BF305: only the explicit exclusive local manifest passes', () => {
  assert.equal(guard(manifest, approved), manifest);
  for (const field of Object.keys(approved))
    assert.throws(() => guard(manifest, { ...approved, [field]: '' }));
});

for (const [field, value] of [
  ['environmentId', 'barberflow'],
  ['baseUrl', 'https://barberflow.expo.app'],
  ['supabaseUrl', 'https://unapproved.supabase.co'],
  ['dbContainer', 'supabase_db_barberflow'],
  ['dbPort', 54322],
  ['mode', 'staging'],
])
  test(`BF305: refuses changed ${field} before side effects`, () => {
    assert.throws(() => guard({ ...manifest, [field]: value }, approved));
  });

test('BF305: reset has no remote or development override', () => {
  assert.ok(resetArguments().includes('--local'));
  for (const args of [['--linked'], ['--db-url', 'postgresql://localhost'], ['--workdir', '.']]) {
    assert.throws(() => resetArguments(args));
  }
});

test('BF305: accounts have stable non-overlapping identities and ephemeral secrets', () => {
  const first = accounts();
  const second = accounts();
  assert.equal(first.a.userId, second.a.userId);
  assert.notEqual(first.a.userId, first.b.userId);
  assert.notEqual(first.a.businessId, first.b.businessId);
  assert.notEqual(first.a.password, second.a.password);
  assert.equal(id('x'), id('x'));
  Object.values(first).forEach((user) => accountGuard(user.email));
  for (const email of [
    'owner@barberflow.local',
    'personal@example.com',
    'bf305.owner-c@example.test',
  ])
    assert.throws(() => accountGuard(email));
});

test('BF305: evidence drops unknown secret fields and rejects secret-shaped allowed values', () => {
  const directory = path.join(privateRoot, 'runs', 'guard-unit');
  try {
    record(directory, 'safe', {
      result: 'PASS',
      password: 'do-not-write',
      Authorization: 'do-not-write',
    });
    const text = fs.readFileSync(path.join(directory, 'safe.json'), 'utf8');
    assert.ok(!text.includes('do-not-write'));
    assert.throws(() => record(directory, 'unsafe', { result: 'secret-token-value' }));
    assert.throws(() => record(path.join(privateRoot, 'outside'), 'safe', { result: 'PASS' }));
    assert.throws(() => record(directory, '../escape', { result: 'PASS' }));
  } finally {
    // Only known files in this test-owned directory; no recursive path deletion.
    const file = path.join(directory, 'safe.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(directory)) fs.rmdirSync(directory);
  }
});

test('BF305: startup diagnostics omit credentials and callback parameters', () => {
  const secret = 'random-local-key-for-test';
  assert.ok(!sanitize(`Error ${secret}`, [secret]).includes(secret));
  for (const value of [
    'Authorization: Bearer hidden',
    'Cookie: hidden',
    'password hidden',
    'PKCE verifier hidden',
  ]) {
    assert.equal(sanitize(value), '[sensitive line omitted]');
  }
  assert.equal(
    sanitize(`${manifest.baseUrl}/auth/recovery?code=hidden#hidden`),
    `${manifest.baseUrl}/auth/recovery`,
  );
  assert.ok(!sanitize('https://external.invalid/auth?code=hidden').includes('hidden'));
});

test('BF305: failed assertions remain failures while secret-bearing context is removed', () => {
  const error = {
    message: 'Error\nfill("ephemeral-credential")\nCookie: hidden',
    stack: 'at fixture\nephemeral-credential',
    errorContext: 'unmasked DOM',
  };
  redactTestError(error, ['ephemeral-credential']);
  assert.ok(error.message.startsWith('Error'));
  assert.ok(!JSON.stringify(error).includes('ephemeral-credential'));
  assert.ok(!JSON.stringify(error).includes('hidden'));
  assert.equal(error.errorContext, undefined);
});
