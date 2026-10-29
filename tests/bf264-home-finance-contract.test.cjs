/* global __dirname */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(
  path.resolve(__dirname, '../src/features/analytics/components/HomeFinanceSummary.tsx'),
  'utf8',
);
test('BF264 is presentational with shared Home result, no second query/router/transport', () => {
  assert.match(source, /HomeDashboardSummaryResult/);
  assert.match(source, /onOpenFinances: \(\) => void/);
  assert.doesNotMatch(
    source,
    /useQuery|useHomeDashboardSummary|analyticsKeys|analyticsService|Repository|supabase|expo-router|\.rpc\(/,
  );
});
test('BF264 formats supplied revenue/profit without accounting or extra fields', () => {
  assert.match(source, /formatMoney\(result\.data\.total_revenue, currency\)/);
  assert.match(source, /formatMoney\(result\.data\.profit, currency\)/);
  assert.doesNotMatch(
    source,
    /Math\.|parseFloat|Number\(|\.expenses|\.appointments|\.active_clients/,
  );
});
