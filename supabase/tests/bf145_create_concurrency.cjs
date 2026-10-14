/* global process, setTimeout */
// Local PostgreSQL connections, authenticated identity, real waits and committed fixtures.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const args = [
  'exec',
  '-i',
  'supabase_db_barberflow',
  'psql',
  '-X',
  '-qAt',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
  '-v',
  'VERBOSITY=verbose',
];
function sql(text) {
  const result = spawnSync('docker', args, { input: text, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function connection() {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, errors }));
  });
  return { child, done, output: () => output };
}
async function until(condition, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for ' + label);
}
async function main() {
  const user = randomUUID();
  const business = randomUUID();
  const member = randomUUID();
  const client = randomUUID();
  const service = randomUUID();
  const items = JSON.stringify([{ service_id: service, quantity: 1 }]);
  const call = (id, start) =>
    `public.create_appointment_with_services('${id}','${business}','${client}','${member}','${start}','${items}')`;
  const identity = `SELECT set_config('request.jwt.claim.sub','${user}',true); SET LOCAL ROLE authenticated;`;
  sql(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${user}');
    INSERT INTO public.businesses(id,name,timezone) VALUES('${business}','BF145 concurrency','UTC');
    INSERT INTO public.business_members(id,business_id,user_id,role) VALUES('${member}','${business}','${user}','OWNER');
    INSERT INTO public.clients(id,business_id,first_name) VALUES('${client}','${business}','Test');
    INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES('${service}','${business}','Concurrent',1.01,30);
    INSERT INTO public.business_settings(business_id) VALUES('${business}');
    INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES('${business}',3,'09:00','12:00');
    COMMIT;`);
  try {
    for (const mode of ['conflict', 'replay', 'overlap']) {
      const id = randomUUID();
      const secondId = mode === 'replay' ? id : randomUUID();
      const start =
        mode === 'conflict'
          ? '2026-10-14T09:00Z'
          : mode === 'replay'
            ? '2026-10-14T10:00Z'
            : '2026-10-14T11:00Z';
      sql(
        `UPDATE public.business_settings SET allow_overlapping_appointments=${mode === 'overlap'} WHERE business_id='${business}';`,
      );
      const name = 'bf145_' + randomUUID().replaceAll('-', '');
      const first = connection();
      const second = connection();
      try {
        first.child.stdin.write(
          `BEGIN; ${identity} SELECT 'JSON:'||${call(id, start)}::text; SELECT 'READY';\n`,
        );
        await until(() => first.output().includes('READY'), 'first uncommitted appointment');
        second.child.stdin.end(
          `SET application_name='${name}'; BEGIN; ${identity} SELECT 'JSON:'||${call(secondId, start)}::text; COMMIT;`,
        );
        await until(
          () =>
            sql(
              `SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0;`,
            ) === '1',
          'second actual lock wait',
        );
        first.child.stdin.end('COMMIT;\n');
        const [a, b] = await Promise.all([first.done, second.done]);
        assert.equal(a.code, 0, a.errors);
        if (mode === 'conflict') {
          assert.notEqual(b.code, 0);
          assert.match(b.errors, /PT409/);
          assert.equal(
            sql(`SELECT count(*) FROM public.appointments WHERE id='${secondId}';`),
            '0',
          );
        } else {
          assert.equal(b.code, 0, b.errors);
          const firstJson = JSON.parse(
            a.output
              .split('\n')
              .find((line) => line.startsWith('JSON:'))
              .slice(5),
          );
          const secondJson = JSON.parse(
            b.output
              .split('\n')
              .find((line) => line.startsWith('JSON:'))
              .slice(5),
          );
          if (mode === 'replay') {
            assert.deepEqual(firstJson, secondJson);
            assert.equal(
              sql(`SELECT count(*) FROM public.appointment_services WHERE appointment_id='${id}';`),
              '1',
            );
          } else {
            assert.notEqual(firstJson.id, secondJson.id);
            assert.equal(
              sql(`SELECT count(*) FROM public.appointments WHERE id IN ('${id}','${secondId}');`),
              '2',
            );
          }
        }
        process.stdout.write(
          `PASS BF145 concurrent ${mode}: observed lock wait then correct persisted result\n`,
        );
      } finally {
        if (!first.child.stdin.destroyed) first.child.stdin.end('ROLLBACK;\n');
        if (!second.child.stdin.destroyed) second.child.stdin.end('ROLLBACK;\n');
        await Promise.all([first.done, second.done]);
      }
    }
    const rr = spawnSync('docker', args, {
      input: `BEGIN ISOLATION LEVEL REPEATABLE READ; ${identity} SELECT ${call(randomUUID(), '2026-10-14T09:00Z')}; ROLLBACK;`,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.notEqual(rr.status, 0);
    assert.match(rr.stderr, /40001/);
    process.stdout.write('PASS BF145 unsafe repeatable-read writes fail closed with 40001\n');
  } finally {
    sql(`BEGIN; DELETE FROM public.appointment_services WHERE appointment_id IN (SELECT id FROM public.appointments WHERE business_id='${business}');
      DELETE FROM public.appointments WHERE business_id='${business}'; DELETE FROM public.services WHERE business_id='${business}';
      DELETE FROM public.clients WHERE business_id='${business}'; DELETE FROM public.business_hours WHERE business_id='${business}';
      DELETE FROM public.business_settings WHERE business_id='${business}'; DELETE FROM public.business_members WHERE business_id='${business}';
      DELETE FROM public.businesses WHERE id='${business}'; DELETE FROM auth.users WHERE id='${user}'; COMMIT;`);
  }
}
main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
