/* global __dirname */
const assert = require('node:assert/strict');
const path = require('node:path');
const manifest = require('../fixtures/environment.json');

const root = path.resolve(__dirname, '../../..');
const privateRoot = path.join(root, '.codex-evals/BF-305');
const workdir = path.join(privateRoot, 'runtime');

function guard(candidate = manifest, env = process.env) {
  assert.deepEqual(candidate, manifest, 'E2E manifest must match the local allowlist');
  assert.equal(env.E2E_ENVIRONMENT_ID, manifest.environmentId, 'Unknown E2E environment');
  assert.equal(env.E2E_BASE_URL, manifest.baseUrl, 'Unknown E2E Web target');
  assert.equal(env.E2E_ALLOW_DESTRUCTIVE_TESTS, 'true', 'E2E destructive flag required');
  for (const value of [candidate.baseUrl, candidate.supabaseUrl]) {
    const url = new URL(value);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
  assert.notEqual(candidate.environmentId, 'barberflow', 'Development stack is forbidden');
  assert.equal(candidate.mode, 'local-only');
  return manifest;
}

function accountGuard(email) {
  assert.match(email, /^bf305\.owner-[ab]@example\.test$/, 'Non-synthetic account refused');
}

function resetArguments(extra = []) {
  assert.equal(extra.length, 0, 'Reset overrides, linked and remote URLs are forbidden');
  return ['db', 'reset', '--local', '--workdir', workdir, '--yes'];
}

module.exports = { manifest, root, privateRoot, workdir, guard, accountGuard, resetArguments };
