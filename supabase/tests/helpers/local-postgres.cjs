// Same Docker/psql transport and pg_blocking_pids barrier as the existing
// concurrency runners. Hardcoded LOCAL container; no env/remote credentials.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const args = [
  'exec',
  '-i',
  'supabase_db_barberflow',
  'psql',
  '-X',
  '-q',
  '-At',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-v',
  'ON_ERROR_STOP=1',
];
const query = (sql) =>
  execFileSync('docker', args, {
    input: sql,
    encoding: 'utf8',
    timeout: 20000,
  }).trim();

class Session {
  constructor() {
    this.child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = '';
    this.errors = '';
    this.pending = null;
    this.failure = null;
    this.child.stderr.on('data', (chunk) => {
      this.errors += chunk;
    });
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      if (!this.pending || !this.buffer.includes(this.pending.marker + '\n')) return;
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      const result = this.buffer.slice(0, this.buffer.indexOf(pending.marker)).trim();
      this.buffer = '';
      pending.resolve(result);
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) =>
      this.fail(new Error(`local psql exit ${code}: ${this.errors}`)),
    );
  }
  fail(error) {
    this.failure = error;
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  sql(sql) {
    if (this.failure) return Promise.reject(this.failure);
    assert.equal(this.pending, null, 'one command per PostgreSQL connection');
    const result = new Promise((resolve, reject) => {
      const marker = `bf302_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(() => {
        this.fail(new Error('BF302 PostgreSQL command deadline exceeded'));
        this.child.kill();
      }, 18000);
      this.pending = { marker, timer, resolve, reject };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
    // A waiter may fail while the coordinator is polling the lock barrier.
    // Keep that rejection observed; awaiting result still propagates the error.
    result.catch(() => {});
    return result;
  }
  async init() {
    this.pid = Number(await this.sql('SELECT pg_backend_pid();'));
    await this.sql(
      "SET statement_timeout='12s'; SET lock_timeout='10s'; SET application_name='bf302-regression';",
    );
    return this;
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.stdin.end('ROLLBACK;\n\\q\n');
    });
  }
}

async function blocked(waiter, holder) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (waiter.failure) throw waiter.failure;
    if (query(`SELECT ${holder.pid}=ANY(pg_blocking_pids(${waiter.pid}));`) === 't') return;
    // Bounded observation polling, not a guessed delay before releasing a lock.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('BF302 expected real PostgreSQL blocking relationship not observed');
}

module.exports = { query, Session, blocked };
