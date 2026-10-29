/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../src'),
  file = path.join(root, 'features/analytics/screens/HomeScreen.tsx'),
  source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const calls = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
    calls.push(node.expression.text);
  ts.forEachChild(node, visit);
}
visit(ast);
test('BF265 calls each contracted data hook once and leaves producer queries owned by their components', () => {
  assert.equal(calls.filter((x) => x === 'useHomeDashboardSummary').length, 1);
  assert.equal(calls.filter((x) => x === 'useNextAppointment').length, 1);
  for (const name of [
    'useAppointments',
    'useLowStockAlerts',
    'useQuery',
    'useQueries',
    'useFinanceQueries',
  ])
    assert(!calls.includes(name), name);
  assert.doesNotMatch(
    source,
    /supabase|Repository|Service|\.rpc\(|\.from\(|setInterval|setTimeout|invalidateQueries|RefreshControl|refetch\(|new Date|financePeriodBounds|homeTodaySegments/,
  );
});
test('BF265 preserves exact route adapter and contains no route-level state/data code', () => {
  const route = fs.readFileSync(path.join(root, 'app/(app)/(tabs)/index.tsx'), 'utf8');
  assert.match(route, /HomeScreen as default.*features\/analytics\/screens\/HomeScreen/);
  assert.doesNotMatch(route, /useQuery|useState|useBusiness|supabase/);
});
test('BF265 leaves SettingsEntry header ownership and existing producer navigation intact', () => {
  assert.match(
    fs.readFileSync(path.join(root, 'features/navigation/components/NavigationTabs.tsx'), 'utf8'),
    /headerRight: \(\) => <SettingsEntry/,
  );
  assert.doesNotMatch(
    source,
    /SettingsEntry|QuickAction|\/agenda|\/clients|\/products|HomeStockScreen/,
  );
  assert.match(
    fs.readFileSync(
      path.join(root, 'features/analytics/components/HomeTodayAppointments.tsx'),
      'utf8',
    ),
    /pathname: '\/appointments\/\[id\]'/,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'features/analytics/components/HomeLowStock.tsx'), 'utf8'),
    /router.push\('\/products'\)/,
  );
});
test('BF265 screen API has no mandatory props and host content creates one scroll with no grid', () => {
  const fn = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'HomeScreen',
  );
  assert(fn);
  assert.equal(fn.parameters.length, 0);
  assert.equal((source.match(/<ScrollView\b/g) || []).length, 1);
  assert.doesNotMatch(source, /flexWrap|flexBasis|columnGap|rowGap|numColumns|order:/);
});
