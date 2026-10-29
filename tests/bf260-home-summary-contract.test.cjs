/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/features/analytics');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('BF260 data path uses canonical summary service/key with no alternate transport or query', () => {
  const hook = read('hooks/useHomeDashboardSummary.ts');
  assert.match(hook, /analyticsService\.getDashboardSummary\(/);
  assert.match(hook, /analyticsKeys\.resource\('summary', scope, range\)/);
  assert.doesNotMatch(
    hook,
    /useFinanceQueries|getRevenueByDay|supabase|\.rpc\(|setInterval|setTimeout|refetchInterval|prefetch|invalidateQueries|homeSummaryService/,
  );
});
test('BF260 pure UI has exact metric projection and no Today-list count or navigation', () => {
  const ui = read('components/HomeKpis.tsx');
  assert.match(ui, /result\.data\.total_revenue/);
  assert.match(ui, /result\.data\.appointments/);
  assert.match(ui, /result\.data\.active_clients/);
  assert.doesNotMatch(
    ui,
    /useQuery|useHomeDashboardSummary|analyticsService|Repository|supabase|expo-router|homeToday|\.length|\.profit|\.expenses/,
  );
});
test('BF260 type reuses FinanceDashboardSummary without a second payload model', () => {
  const code = read('types/home.types.ts');
  const ast = ts.createSourceFile('home.types.ts', code, ts.ScriptTarget.Latest, true);
  const type = ast.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'HomeDashboardSummaryResult',
  );
  assert(type && ts.isUnionTypeNode(type.type));
  assert.equal(type.type.types.length, 4);
  assert.match(type.getText(ast), /data: FinanceDashboardSummary/);
  assert.doesNotMatch(code, /type FinanceDashboardSummary\s*=/);
});
