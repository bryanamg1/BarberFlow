/* global __dirname */
// Local-only real RPC/SDK/repository and synchronized concurrency checks.
// Committed synthetic fixtures are removed by the authorized final local reset.
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
let stage = 'local prerequisites';
const writers = new Set();
function sql(input) {
  const r = spawnSync('docker', database, { input, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, 'Local SQL check failed (details withheld)');
  return r.stdout.trim();
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForLock() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const blocked = sql(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%adjust_stock%' AND application_name NOT LIKE 'bf223-writer%';",
    );
    if (Number(blocked) > 0) return;
    await delay(100);
  }
  throw new Error('Competing RPC did not reach the database lock');
}
async function holdAdjustment(userId, business, product, operation, delta, reason = 'ADJUSTMENT') {
  const writer = spawn('docker', database, { stdio: ['pipe', 'pipe', 'pipe'] });
  writers.add(writer);
  const exit = once(writer, 'exit');
  let timer;
  const ready = new Promise((resolve, reject) => {
    let output = '';
    writer.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('BF223_READY')) resolve();
    });
    writer.once('error', reject);
    writer.once('exit', () => reject(new Error('Writer exited before synchronization')));
    timer = setTimeout(() => reject(new Error('Writer synchronization timeout')), 10000);
  });
  writer.stdin.write(`SET application_name = 'bf223-writer'; SET statement_timeout = '15s'; BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims','{"sub":"${userId}","role":"authenticated"}',true);
    SELECT public.adjust_stock('${business}','${operation}','${product}',${delta},'${reason}','writer original');
    SELECT 'BF223_READY';\n`);
  try {
    await ready;
  } finally {
    clearTimeout(timer);
  }
  return async (commit) => {
    writer.stdin.end(commit ? 'COMMIT;\n' : 'ROLLBACK;\n');
    const [code] = await exit;
    writers.delete(writer);
    assert.equal(code, 0, 'Writer transaction failed');
  };
}
async function main() {
  // CLI credentials are captured only in memory, never printed or persisted.
  const status = JSON.parse(
    execSync('npx supabase status -o json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const url = new URL(status.API_URL);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local API required');
  assert.equal(url.port, '54321', 'Expected local BarberFlow API');
  assert(status.ANON_KEY, 'Local public key unavailable');
  const newClient = () =>
    createClient(url.href, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
      },
    });
  const owner = newClient(),
    barber = newClient(),
    anonymous = newClient();
  async function identity(client) {
    const result = await client.auth.signUp({
      email: `bf223-${crypto.randomUUID()}@fixture.invalid`,
      password: crypto.randomBytes(24).toString('base64url'),
    });
    assert.equal(result.error?.code ?? null, null, 'Local synthetic signup failed');
    assert(result.data.session && result.data.user, 'Local confirmations must be disabled');
    return result.data.user.id;
  }
  let checks = 0;
  try {
    const user = await identity(owner),
      barberId = await identity(barber);
    const business = crypto.randomUUID(),
      foreign = crypto.randomUUID();
    const products = Array.from({ length: 5 }, () => crypto.randomUUID());
    sql(`BEGIN;
      INSERT INTO public.businesses(id,name) VALUES('${business}','BF223 SDK fixture'),('${foreign}','BF223 foreign SDK fixture');
      INSERT INTO public.business_members(business_id,user_id,role) VALUES('${business}','${user}','OWNER'),('${business}','${barberId}','BARBER');
      INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost,is_active) VALUES
        ('${products[0]}','${business}','BF223 active',10,4,true),('${products[1]}','${business}','BF223 archived',10,4,false),
        ('${products[2]}','${business}','BF223 empty ledger',10,4,true),('${products[3]}','${business}','BF223 revocation',10,4,true),
        ('${products[4]}','${foreign}','BF223 foreign',10,4,true);
      COMMIT;`);
    const api = repository(owner);
    const adjust = (
      operation,
      product,
      delta,
      reason = 'ADJUSTMENT',
      notes = null,
      client = owner,
    ) =>
      client.rpc('adjust_stock', {
        p_business_id: business,
        p_operation_id: operation,
        p_product_id: product,
        p_quantity_delta: delta,
        p_reason: reason,
        p_notes: notes,
      });
    const stock = async (product) => {
      const r = await api.getProductStock(business, [product]);
      assert.equal(r.error, null, 'Derived stock RPC failed');
      return r.data[0].current_stock;
    };
    const history = async (product) => {
      const r = await api.listStockMovements(business, product, { page: 1, pageSize: 25 });
      assert.equal(r.error, null, 'History repository failed');
      return r.data;
    };

    stage = 'normal SDK write -> derived stock -> repository history';
    const op = crypto.randomUUID();
    const created = await adjust(op, products[0], 10, 'ADJUSTMENT', '  texto original\n');
    assert.equal(created.error, null, 'Owner adjustment failed');
    assert.equal(created.status, 200);
    assert.equal(Array.isArray(created.data), false, 'RPC must return one object');
    assert.deepEqual(
      Object.keys(created.data).sort(),
      [
        'id',
        'business_id',
        'product_id',
        'type',
        'quantity_delta',
        'unit_cost',
        'reference_type',
        'reference_id',
        'notes',
        'occurred_at',
        'created_by',
        'created_at',
      ].sort(),
    );
    assert.equal(created.data.created_by, user);
    assert.equal(created.data.notes, '  texto original\n');
    assert.equal(created.data.unit_cost, null);
    assert.equal(created.data.reference_id, op);
    assert.equal(await stock(products[0]), '10');
    assert.deepEqual((await history(products[0]))[0], created.data);
    checks++;
    stage = 'normal SDK replay and archived catalog';
    const replay = await adjust(op, products[1], 999, 'LOSS', 'different');
    assert.equal(replay.error, null);
    assert.deepEqual(replay.data, created.data);
    assert.equal((await history(products[0])).length, 1);
    assert.equal(await stock(products[1]), '0');
    const archived = await adjust(crypto.randomUUID(), products[1], 2);
    assert.equal(archived.error, null);
    assert.equal(await stock(products[1]), '2');
    checks++;
    stage = 'normal SDK permission and reference negatives';
    for (const deniedClient of [barber, anonymous]) {
      const denied = await adjust(
        crypto.randomUUID(),
        products[0],
        1,
        'ADJUSTMENT',
        null,
        deniedClient,
      );
      assert.equal(denied.data, null);
      assert.equal(denied.error.code, '42501');
    }
    for (const product of [products[4], crypto.randomUUID()]) {
      const denied = await adjust(crypto.randomUUID(), product, 1);
      assert.equal(denied.data, null);
      assert.equal(denied.error.code, 'P0002');
      assert.equal(denied.error.message, 'Product unavailable');
    }
    assert.equal(await stock(products[0]), '10');
    checks++;

    stage = 'concurrent different operations cannot overdraw';
    const releaseLoss = await holdAdjustment(
      user,
      business,
      products[0],
      crypto.randomUUID(),
      -7,
      'LOSS',
    );
    const racingLoss = Promise.resolve(adjust(crypto.randomUUID(), products[0], -7, 'LOSS'));
    await waitForLock();
    assert.equal(await stock(products[0]), '10', 'Uncommitted movement leaked');
    await releaseLoss(true);
    const losing = await racingLoss;
    assert.equal(losing.data, null);
    assert.equal(losing.error.code, 'PT409');
    assert.equal(losing.error.details, 'INSUFFICIENT_STOCK');
    assert.equal(await stock(products[0]), '3');
    assert.equal((await history(products[0])).length, 2);
    checks++;

    stage = 'concurrent same operation with changed product returns original';
    const concurrentOp = crypto.randomUUID();
    const releaseReplay = await holdAdjustment(user, business, products[0], concurrentOp, 4);
    const racingReplay = Promise.resolve(
      adjust(concurrentOp, products[1], -999, 'LOSS', 'changed'),
    );
    await waitForLock();
    await releaseReplay(true);
    const duplicate = await racingReplay;
    assert.equal(duplicate.error, null);
    assert.equal(duplicate.data.product_id, products[0]);
    assert.equal(duplicate.data.quantity_delta, 4);
    assert.equal(duplicate.data.notes, 'writer original');
    assert.deepEqual((await adjust(concurrentOp, products[0], 1)).data, duplicate.data);
    assert.equal(
      (await history(products[0])).filter((x) => x.reference_id === concurrentOp).length,
      1,
    );
    assert.equal(await stock(products[0]), '7');
    assert.equal(await stock(products[1]), '2');
    checks++;

    stage = 'rollback is excluded from the waiting adjustment balance';
    const rolledBackOp = crypto.randomUUID();
    const releaseRollback = await holdAdjustment(user, business, products[0], rolledBackOp, 99);
    const afterRollback = Promise.resolve(adjust(crypto.randomUUID(), products[0], -8, 'LOSS'));
    await waitForLock();
    assert.equal(await stock(products[0]), '7');
    await releaseRollback(false);
    assert.equal((await afterRollback).error.code, 'PT409');
    assert.equal(await stock(products[0]), '7');
    assert.equal(
      (await history(products[0])).some((x) => x.reference_id === rolledBackOp),
      false,
    );
    checks++;

    stage = 'empty ledger product anchor and exact depletion';
    const releaseEmpty = await holdAdjustment(user, business, products[2], crypto.randomUUID(), 1);
    const deplete = Promise.resolve(adjust(crypto.randomUUID(), products[2], -1, 'LOSS'));
    await waitForLock();
    await releaseEmpty(true);
    assert.equal((await deplete).error, null);
    assert.equal(await stock(products[2]), '0');
    assert.equal((await history(products[2])).length, 2);
    checks++;

    stage = 'membership revoked while waiting cannot write';
    const releaseRevocation = await holdAdjustment(
      user,
      business,
      products[3],
      crypto.randomUUID(),
      1,
    );
    const revoked = Promise.resolve(adjust(crypto.randomUUID(), products[3], 2));
    await waitForLock();
    sql(
      `UPDATE public.business_members SET is_active = false WHERE business_id = '${business}' AND user_id = '${user}';`,
    );
    await releaseRevocation(true);
    assert.equal((await revoked).error.code, '42501');
    const replayDenied = await adjust(op, products[0], 1);
    assert.equal(replayDenied.error.code, '42501');
    sql(
      `UPDATE public.business_members SET is_active = true WHERE business_id = '${business}' AND user_id = '${user}';`,
    );
    assert.equal(await stock(products[3]), '1');
    assert.equal((await history(products[3])).length, 1);
    checks++;

    stage = 'stale transaction snapshots fail before any write';
    for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
      const rejectedOp = crypto.randomUUID();
      sql(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL ROLE authenticated;
        SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated"}',true);
        DO $$ BEGIN
          PERFORM public.adjust_stock('${business}','${rejectedOp}','${products[0]}',1,'ADJUSTMENT',NULL);
          RAISE EXCEPTION 'Unsupported snapshot accepted';
        EXCEPTION WHEN serialization_failure THEN NULL; END; $$; ROLLBACK;`);
      assert.equal(
        (await history(products[0])).some((x) => x.reference_id === rejectedOp),
        false,
      );
    }
    checks++;
    stage = 'catalog and direct ledger writes remain unchanged';
    const direct = await owner.from('stock_movements').insert({
      business_id: business,
      product_id: products[0],
      type: 'ADJUSTMENT',
      quantity_delta: 1,
      created_by: user,
    });
    assert.equal(direct.error.code, '42501');
    assert.equal(
      sql(
        `SELECT count(*) FROM public.products WHERE business_id = '${business}' AND sale_price = 10 AND default_purchase_cost = 4 AND updated_at = created_at;`,
      ),
      '4',
    );
    assert.equal(await stock(products[0]), '7');
    checks++;
    process.stdout.write(
      `PASS ${checks}/${checks} local BF223 integration groups: real SDK writes, BF220/BF221 reads, synchronized concurrency/replay/rollback/revocation/isolation.\n`,
    );
    process.stdout.write(
      'Synthetic committed fixtures await the authorized final local reset. No service-role client or remote DB used.\n',
    );
  } finally {
    for (const writer of writers) if (writer.exitCode === null) writer.stdin.end('ROLLBACK;\n');
    await Promise.allSettled([
      owner.auth.signOut({ scope: 'local' }),
      barber.auth.signOut({ scope: 'local' }),
    ]);
  }
}
main().catch(() => {
  process.stderr.write(
    `FAIL BF223 local integration at stage: ${stage}; sensitive details withheld.\n`,
  );
  process.exitCode = 1;
});
