/* global process, setTimeout */
// Local integration test: real PostgreSQL sessions, never a remote connection.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const args = [
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
  '-At',
];
function sql(input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function session(name) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (v) => {
    output += v;
  });
  child.stderr.on('data', (v) => {
    output += v;
  });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, output })));
  child.stdin.write(`SET application_name = '${name}';\n\\set VERBOSITY verbose\n`);
  return { child, done, send: (v) => child.stdin.write(v + '\n'), output: () => output };
}
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.fail(message);
}

async function main() {
  const user = randomUUID();
  const businesses = [];
  const sessions = [];
  sql(`INSERT INTO auth.users(id) VALUES ('${user}');`);
  try {
    for (const source of ['sales', 'payments', 'purchases', 'expenses']) {
      for (const financialFirst of [true, false]) {
        const business = randomUUID();
        const foreign = randomUUID();
        const category = randomUUID();
        const parent = randomUUID();
        businesses.push(business, foreign);
        sql(`INSERT INTO public.businesses(id,name,currency_code,timezone) VALUES
          ('${business}','BF272 race','ARS','UTC'), ('${foreign}','BF272 parent','ARS','UTC');
          INSERT INTO public.business_members(business_id,user_id,role) VALUES ('${business}','${user}','OWNER');
          INSERT INTO public.expense_categories(id,business_id,name) VALUES ('${category}','${business}','Test');
          INSERT INTO public.sales(id,business_id,operation_id,subtotal,total,created_by)
          VALUES ('${parent}','${foreign}','${randomUUID()}',0,0,'${user}');`);
        const insert = {
          sales: `INSERT INTO public.sales(business_id,operation_id,subtotal,total,created_by) VALUES ('${business}','${randomUUID()}',0,0,'${user}');`,
          payments: `INSERT INTO public.payments(business_id,sale_id,payment_method,amount,created_by) VALUES ('${business}','${parent}','CASH',1,'${user}');`,
          purchases: `INSERT INTO public.purchases(business_id,operation_id,supplier,total,created_by) VALUES ('${business}','${randomUUID()}','Test',0,'${user}');`,
          expenses: `INSERT INTO public.expenses(business_id,category_id,source_type,description,amount,payment_method,expense_date,created_by) VALUES ('${business}','${category}','MANUAL','Test',0,'CASH','2026-01-01','${user}');`,
        }[source];
        const update = `UPDATE public.businesses SET currency_code='USD' WHERE id='${business}';`;
        const nameA = 'bf272_a_' + randomUUID();
        const nameB = 'bf272_b_' + randomUUID();
        const a = session(nameA);
        const b = session(nameB);
        sessions.push(a, b);
        a.send(`BEGIN; ${financialFirst ? insert : update} SELECT 'READY_A';`);
        await until(() => a.output().includes('READY_A'), 'First writer failed: ' + a.output());
        b.send(`BEGIN; ${financialFirst ? update : insert} COMMIT;`);
        await until(
          () =>
            sql(
              `SELECT count(*) FROM pg_stat_activity WHERE application_name='${nameB}' AND cardinality(pg_blocking_pids(pid))>0;`,
            ) === '1',
          'Second writer did not wait for the shared business lock',
        );
        a.send('COMMIT;');
        a.child.stdin.end();
        b.child.stdin.end();
        assert.equal((await a.done).code, 0);
        const result = await b.done;
        if (financialFirst) {
          assert.notEqual(result.code, 0);
          assert.match(result.output, /P0272/);
          assert.equal(
            sql(`SELECT currency_code FROM public.businesses WHERE id='${business}';`),
            'ARS',
          );
        } else {
          assert.equal(result.code, 0, result.output);
          assert.equal(
            sql(`SELECT currency_code FROM public.businesses WHERE id='${business}';`),
            'USD',
          );
          assert.equal(
            sql(`SELECT count(*) FROM public.${source} WHERE business_id='${business}';`),
            '1',
          );
        }
        process.stdout.write(
          `PASS ${source}: ${financialFirst ? 'history first rejects currency' : 'currency first serializes history'}\n`,
        );
      }
    }
    // Moving existing history must take the destination lock just like the first INSERT.
    const oldBusiness = randomUUID();
    const newBusiness = randomUUID();
    const movedSale = randomUUID();
    businesses.push(oldBusiness, newBusiness);
    sql(`INSERT INTO public.businesses(id,name,currency_code,timezone) VALUES
      ('${oldBusiness}','BF272 move source','ARS','UTC'), ('${newBusiness}','BF272 move destination','ARS','UTC');
      INSERT INTO public.sales(id,business_id,operation_id,subtotal,total,created_by)
      VALUES ('${movedSale}','${oldBusiness}','${randomUUID()}',0,0,'${user}');`);
    const mover = session('bf272_move_' + randomUUID());
    const waiterName = 'bf272_move_waiter_' + randomUUID();
    const waiter = session(waiterName);
    sessions.push(mover, waiter);
    mover.send(
      `BEGIN; UPDATE public.sales SET business_id='${newBusiness}' WHERE id='${movedSale}'; SELECT 'READY_MOVE';`,
    );
    await until(() => mover.output().includes('READY_MOVE'), 'History move failed');
    waiter.send(`UPDATE public.businesses SET currency_code='USD' WHERE id='${newBusiness}';`);
    await until(
      () =>
        sql(
          `SELECT count(*) FROM pg_stat_activity WHERE application_name='${waiterName}' AND cardinality(pg_blocking_pids(pid))>0;`,
        ) === '1',
      'Currency did not wait for history move',
    );
    mover.send('COMMIT;');
    mover.child.stdin.end();
    waiter.child.stdin.end();
    assert.equal((await mover.done).code, 0);
    assert.match((await waiter.done).output, /P0272/);
    assert.equal(
      sql(`SELECT currency_code FROM public.businesses WHERE id='${newBusiness}';`),
      'ARS',
    );
    process.stdout.write('PASS moving history serializes destination currency change\n');
    const isolated = randomUUID();
    businesses.push(isolated);
    sql(
      `INSERT INTO public.businesses(id,name,currency_code,timezone) VALUES ('${isolated}','BF272 isolation','ARS','UTC');`,
    );
    sql(
      `BEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE public.businesses SET timezone='America/Argentina/Buenos_Aires',currency_code='ARS' WHERE id='${isolated}'; ROLLBACK;`,
    );
    const retry = spawnSync('docker', args, {
      input: `\\set VERBOSITY verbose\nBEGIN ISOLATION LEVEL REPEATABLE READ; UPDATE public.businesses SET currency_code='USD' WHERE id='${isolated}';`,
      encoding: 'utf8',
    });
    assert.notEqual(retry.status, 0);
    assert.match(retry.stderr, /40001/);
    process.stdout.write(
      'PASS transaction-wide snapshot fails safely; no-op/timezone remain allowed\n',
    );
  } finally {
    for (const s of sessions)
      if (s.child.exitCode === null) {
        s.send('ROLLBACK;');
        s.child.stdin.end();
      }
    await Promise.all(sessions.map((s) => s.done));
    if (businesses.length) {
      const ids = businesses.map((v) => `'${v}'`).join(',');
      sql(`BEGIN;
        DELETE FROM public.payments WHERE business_id IN (${ids});
        DELETE FROM public.expenses WHERE business_id IN (${ids});
        DELETE FROM public.sales WHERE business_id IN (${ids});
        DELETE FROM public.purchases WHERE business_id IN (${ids});
        DELETE FROM public.expense_categories WHERE business_id IN (${ids});
        DELETE FROM public.business_members WHERE business_id IN (${ids});
        DELETE FROM public.businesses WHERE id IN (${ids});
        DELETE FROM auth.users WHERE id='${user}'; COMMIT;`);
    }
  }
}
main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
