/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const component = fs.readFileSync(
  path.join(root, 'src/features/analytics/components/FinanceServicesPanel.tsx'),
  'utf8',
);
const types = ts.createSourceFile(
  'finance.types.ts',
  fs.readFileSync(path.join(root, 'src/features/analytics/types/finance.types.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);

test('BF254 exact string projection matches the approved BF243 SQL return columns', () => {
  const row = types.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'FinanceServiceRow',
  );
  assert(row && ts.isTypeLiteralNode(row.type));
  assert.deepEqual(
    row.type.members.map((m) => [m.name.text, m.type.kind]),
    ['service_id', 'name', 'quantity', 'net_revenue'].map((n) => [n, ts.SyntaxKind.StringKeyword]),
  );
});
test('BF254 imports only presentation/context infrastructure; no data/catalog/period/limit ownership', () => {
  const tree = ts.createSourceFile(
    'panel.tsx',
    component,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = tree.statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text);
  assert(
    imports.every(
      (p) => !/supabase|repositories|services\/|hooks\/|query|products|catalog/i.test(p),
    ),
  );
  assert.doesNotMatch(
    component,
    /\.(?:sort|slice|filter)\(|\b(?:useState|useEffect|useQuery|fetch|Number|parseFloat|parseInt)\s*\(/,
  );
  assert.match(component, /key=\{row\.id\}/);
  assert.match(component, /id: row\.service_id/);
});
