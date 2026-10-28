/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const source = read('src/features/analytics/components/FinanceProductsExpensesPanel.tsx');
const types = ts.createSourceFile(
  'finance.types.ts',
  read('src/features/analytics/types/finance.types.ts'),
  ts.ScriptTarget.Latest,
  true,
);
test('BF255 product projection matches actual BF244 return columns without additions', () => {
  const row = types.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'FinanceProductRow',
  );
  assert(row && ts.isTypeLiteralNode(row.type));
  const fields = row.type.members.map((m) => m.name.text);
  assert.deepEqual(fields, [
    'product_id',
    'name',
    'quantity',
    'net_revenue',
    'cogs',
    'gross_profit',
  ]);
  for (const member of row.type.members)
    assert.equal(member.type.kind, ts.SyntaxKind.StringKeyword);
  const sql = read('supabase/migrations/20261027040000_top_products.sql');
  const returnColumns = sql
    .match(/RETURNS TABLE\s*\(([\s\S]*?)\)/i)[1]
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0]);
  assert.deepEqual(fields, returnColumns);
});
test('BF255 expense projection compatible with BF242 JSON; no invented name/detail/receipt field', () => {
  const row = types.statements.find(
    (s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'FinanceExpenseSummary',
  );
  assert(row && ts.isTypeLiteralNode(row.type));
  assert.deepEqual(
    row.type.members.map((m) => m.name.text),
    ['manual_total', 'purchase_total', 'total', 'by_category'],
  );
  const sql = read('supabase/migrations/20261020000000_expense_summary.sql');
  for (const key of [
    'manual_total',
    'purchase_total',
    'total',
    'by_category',
    'category_id',
    'amount',
  ])
    assert(sql.includes(`'${key}'`));
  assert(sql.includes("purchase.status <> 'VOIDED'"));
});
test('BF255 imports and source preserve presentation-only boundaries and original ordering', () => {
  const tree = ts.createSourceFile(
    'panel.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = tree.statements.filter(ts.isImportDeclaration).map((s) => s.moduleSpecifier.text);
  assert(imports.every((p) => !/supabase|repositories|services\/|hooks\/|query|catalog/i.test(p)));
  assert.doesNotMatch(
    source,
    /\.(?:sort|slice|filter|reduce)\(|\b(?:useState|useEffect|useQuery|fetch|Number|parseFloat|parseInt)\s*\(/,
  );
  assert.doesNotMatch(source, /net_revenue\s*-\s*(?:row\.)?cogs/);
  assert.match(source, /key=\{row\.id\}/);
  assert.match(source, /id: row\.product_id/);
});
