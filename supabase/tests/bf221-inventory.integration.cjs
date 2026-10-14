/* global __dirname */
// Explicit local-only integration, outside the mocked unit suite.
// Run before the authorized final `supabase db reset --local`, which removes these
// isolated committed fixtures. Never disable the append-only trigger for cleanup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execSync, spawnSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../..');
const database = [
  'exec',
  '-i',
  'supabase_db_barberflow',
  'psql',
  '-X',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-Atq',
];
function sql(input) {
  const r = spawnSync('docker', database, { input, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, 'Local fixture SQL failed (details withheld)');
}
function repository(client) {
  const filename = path.join(root, 'src/features/inventory/repositories/inventoryRepository.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  return module.exports.inventoryRepository;
}
async function main() {
  // Capture CLI output privately in memory; never print keys/session/password.
  const status = JSON.parse(
    execSync('npx supabase status -o json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const url = new URL(status.API_URL);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local API is required');
  assert.equal(url.port, '54321', 'Expected local BarberFlow API');
  assert(status.ANON_KEY, 'Local public key unavailable');
  const client = createClient(url.href, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anonymous = createClient(url.href, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `bf221-${crypto.randomUUID()}@fixture.invalid`;
  const password = crypto.randomBytes(24).toString('base64url');
  const signup = await client.auth.signUp({ email, password });
  assert.equal(signup.error?.code ?? null, null, 'Local synthetic signup failed');
  assert(signup.data.session && signup.data.user, 'Local confirmations must be disabled');
  const userId = signup.data.user.id;
  const business = crypto.randomUUID(),
    foreign = crypto.randomUUID();
  const p = Array.from({ length: 5 }, () => crypto.randomUUID());
  sql(`BEGIN;
    INSERT INTO public.businesses(id,name) VALUES('${business}','BF221 SDK fixture'),('${foreign}','BF221 foreign SDK fixture');
    INSERT INTO public.business_members(business_id,user_id,role) VALUES('${business}','${userId}','OWNER');
    INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,minimum_stock,is_active) VALUES
      ('${p[0]}','${business}','A',10,4,20,true),('${p[1]}','${business}','B',10,4,0,true),
      ('${p[2]}','${business}','C',10,4,0,false),('${p[3]}','${business}','D',10,4,0,true),
      ('${p[4]}','${foreign}','Foreign',10,4,0,true);
    INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES
      ('${business}','${p[0]}','PURCHASE',21,'${userId}'),('${business}','${p[0]}','SALE',-1,'${userId}'),
      ('${business}','${p[2]}','LOSS',-2,'${userId}'),
      ('${business}','${p[3]}','PURCHASE',2147483647,'${userId}'),('${business}','${p[3]}','PURCHASE',2147483647,'${userId}');
    COMMIT;
  `);
  const api = repository(client);
  let checks = 0;
  const stock = await api.getProductStock(business, [...p, p[0], crypto.randomUUID()]);
  assert.equal(stock.error, null);
  assert.equal(stock.status, 200);
  assert.deepEqual(
    stock.data,
    p
      .slice(0, 4)
      .map((id, i) => ({ product_id: id, current_stock: ['20', '0', '-2', '4294967294'][i] }))
      .sort((a, b) => a.product_id.localeCompare(b.product_id)),
  );
  checks++;
  const low = await api.getLowStockProducts(business, { page: 1, pageSize: 1 });
  assert.equal(low.error, null);
  assert.deepEqual(low.data, [
    { product_id: p[0], name: 'A', minimum_stock: 20, current_stock: '20' },
    { product_id: p[1], name: 'B', minimum_stock: 0, current_stock: '0' },
  ]);
  checks++;
  const second = await api.getLowStockProducts(business, { page: 2, pageSize: 1 });
  assert.equal(second.error, null);
  assert.deepEqual(second.data, [low.data[1]]);
  checks++;
  assert.deepEqual((await api.getProductStock(business, [])).data, []);
  assert.deepEqual((await api.getProductStock(business, [p[4], crypto.randomUUID()])).data, []);
  checks++;
  const denied = await api.getProductStock(foreign, [p[4]]);
  assert.equal(denied.data, null);
  assert.equal(denied.error.code, '42501');
  checks++;
  const anonymousResult = await repository(anonymous).getLowStockProducts(business, {
    page: 1,
    pageSize: 25,
  });
  assert.equal(anonymousResult.data, null);
  assert.equal(anonymousResult.error.code, '42501');
  checks++;

  // A real concurrent transaction has written, but not committed. RPC snapshot
  // sees 20, then 20 after rollback; a separate committed delta changes it to 22.
  const writer = spawn('docker', database, { stdio: ['pipe', 'pipe', 'pipe'] });
  const writerExit = once(writer, 'exit');
  let timer;
  try {
    const ready = new Promise((resolve, reject) => {
      let output = '';
      writer.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('BF221_READY')) resolve();
      });
      writer.once('error', reject);
      writer.once('exit', () => reject(new Error('Local writer exited before synchronization')));
      timer = setTimeout(() => reject(new Error('Local writer synchronization timeout')), 10000);
    });
    writer.stdin
      .write(`BEGIN; INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by)
      VALUES('${business}','${p[0]}','ADJUSTMENT',99,'${userId}'); SELECT 'BF221_READY';\n`);
    await ready;
    clearTimeout(timer);
    assert.deepEqual((await api.getProductStock(business, [p[0]])).data, [
      { product_id: p[0], current_stock: '20' },
    ]);
    writer.stdin.end('ROLLBACK;\n');
    const [exit] = await writerExit;
    assert.equal(exit, 0);
    assert.deepEqual((await api.getProductStock(business, [p[0]])).data, [
      { product_id: p[0], current_stock: '20' },
    ]);
    checks++;
  } finally {
    clearTimeout(timer);
    if (writer.exitCode === null) writer.stdin.end('ROLLBACK;\n');
  }
  sql(
    `INSERT INTO public.stock_movements(business_id,product_id,type,quantity_delta,created_by) VALUES('${business}','${p[0]}','ADJUSTMENT',2,'${userId}');`,
  );
  assert.deepEqual((await api.getProductStock(business, [p[0]])).data, [
    { product_id: p[0], current_stock: '22' },
  ]);
  const after = await api.getLowStockProducts(business, { page: 1, pageSize: 25 });
  assert.equal(after.error, null);
  assert.deepEqual(after.data, [
    { product_id: p[1], name: 'B', minimum_stock: 0, current_stock: '0' },
  ]);
  checks++;
  await client.auth.signOut({ scope: 'local' });
  process.stdout.write(
    `PASS ${checks}/${checks} local SQL RPC -> installed Supabase SDK -> inventoryRepository integration checks; concurrent snapshot/rollback/commit verified.\n`,
  );
  process.stdout.write(
    'Committed synthetic fixtures remain only until the authorized final local DB reset. No service-role client used.\n',
  );
}
main().catch(() => {
  process.stderr.write(
    'FAIL BF221 local integration; sensitive provider/credential details withheld.\n',
  );
  process.exitCode = 1;
});
