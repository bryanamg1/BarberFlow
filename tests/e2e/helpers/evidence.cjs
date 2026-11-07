const fs = require('node:fs');
const path = require('node:path');
const { privateRoot, manifest } = require('./environment.cjs');
const { redactTestError } = require('./diagnostics.cjs');

// Persist an allowlist, never an Error, request, response, Auth result or process environment.
function record(directory, name, values) {
  if (!path.resolve(directory).startsWith(path.join(privateRoot, 'runs') + path.sep)) {
    throw new Error('Evidence outside the private run directory refused');
  }
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid evidence name');
  const allowed = [
    'runId',
    'sha',
    'platform',
    'case',
    'result',
    'durationMs',
    'cleanup',
    'stage',
    'failureClass',
    'count',
  ];
  const output = {
    timestamp: new Date().toISOString(),
    environmentId: manifest.environmentId,
    target: 'exclusive-local-web',
  };
  const patterns = {
    runId: /^[0-9TZ-]+-[a-f0-9]{8}$/,
    sha: /^[a-f0-9]{40}$/,
    platform: /^web-chromium$/,
    case: /^BF30[568]-\d+$/,
    result: /^(PASS|FAIL|passed|failed|timedOut|interrupted|skipped)$/,
    cleanup: /^(PASS|FAIL)$/,
    stage:
      /^(preflight|startup|full-reset|fixtures|backend-health|web-startup|web-tests|soft-reset|cleanup)$/,
    failureClass:
      /^(PRODUCT_FAILURE|TEST_FAILURE|ENVIRONMENT_FAILURE|ACCOUNT_FAILURE|RESET_FAILURE|PROVIDER_FAILURE)$/,
  };
  for (const key of allowed) {
    if (values[key] !== undefined) {
      const value = values[key];
      if (['durationMs', 'count'].includes(key) && Number.isFinite(value) && value >= 0)
        output[key] = value;
      else if (typeof value === 'string' && patterns[key]?.test(value)) {
        output[key] = value;
      } else throw new Error('Unsafe evidence value refused');
    }
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(output, null, 2) + '\n');
}

class SafeReporter {
  onTestEnd(test, result) {
    const name = test.title.match(/^BF30[568]-\d+/)?.[0];
    if (!name || !process.env.E2E_RUN_DIRECTORY) throw new Error('Unidentified E2E case');
    record(process.env.E2E_RUN_DIRECTORY, name.toLowerCase(), {
      runId: process.env.E2E_RUN_ID,
      sha: process.env.E2E_GIT_SHA,
      platform: 'web-chromium',
      case: name,
      result: result.status,
      durationMs: result.duration,
    });
    // No Playwright error formatting: assertion logs can include filled input values.
    process.stdout.write(`${name}: ${result.status}\n`);
    if (result.errors.length) {
      const secrets = [
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        ...Object.values(JSON.parse(process.env.E2E_ACCOUNTS)).map((user) => user.password),
      ];
      const errors = result.errors.map((error) => {
        const safe = { message: error.message, stack: error.stack };
        redactTestError(safe, secrets);
        return safe;
      });
      fs.writeFileSync(
        path.join(process.env.E2E_RUN_DIRECTORY, `${name.toLowerCase()}-error.json`),
        JSON.stringify(errors, null, 2) + '\n',
      );
    }
  }
}

module.exports = SafeReporter;
module.exports.record = record;
