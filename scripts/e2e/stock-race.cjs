const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { manifest } = require('../../tests/e2e/helpers/environment.cjs');
const local = require('./local.cjs');

async function contend(first, second) {
  local.verifyContainer();
  const holder = spawn(
    'docker',
    [
      'exec',
      '-i',
      manifest.dbContainer,
      'psql',
      '-XqAt',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  holder.stderr.resume();
  holder.stdin.on('error', () => {});
  const lines = createInterface({ input: holder.stdout });
  let calls;
  const finished = new Promise((resolve) => {
    holder.once('error', () => resolve(null));
    holder.once('close', resolve);
  });
  try {
    const pid = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('BF308 barrier startup timeout')), 6000);
      lines.once('line', (line) => {
        clearTimeout(timeout);
        resolve(Number(line));
      });
      finished.then(() => {
        clearTimeout(timeout);
        reject(new Error('BF308 barrier exited early'));
      });
      holder.stdin.write(`BEGIN;
        SET LOCAL idle_in_transaction_session_timeout='15s';
        SELECT pg_backend_pid() FROM public.businesses WHERE id='${local.id('tenant-a')}' FOR NO KEY UPDATE;\n`);
    });
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    calls = Promise.allSettled([first(), second()]);
    const deadline = Date.now() + 6000;
    let waiting = 0;
    do {
      waiting = Number(
        local.sql(`WITH RECURSIVE waiters(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE ${pid}=ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid=ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*) FROM waiters w JOIN pg_stat_activity a USING(pid)
        WHERE a.query LIKE '%complete_checkout%';`),
      );
      if (waiting === 2) break;
      await delay(25);
    } while (Date.now() < deadline);
    assert.equal(waiting, 2, 'Both independent HTTP checkouts must wait in PostgreSQL');
    holder.stdin.end('COMMIT;\n\\q\n');
    assert.equal(await finished, 0);
    return (await calls).map((result) => {
      assert.equal(result.status, 'fulfilled', 'Checkout transport failed during contention');
      return result.value;
    });
  } finally {
    if (!holder.stdin.writableEnded) holder.stdin.end('ROLLBACK;\n\\q\n');
    await finished;
    await calls;
    lines.close();
  }
}

module.exports = { contend };
