const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { spawn, execFileSync } = require('node:child_process');
const { stop, terminated, cleanup } = require('../scripts/e2e/process.cjs');
const { webCommand } = require('../scripts/e2e/web.cjs');

test('BF305 lifecycle: Web command binds localhost on the manifest IPv4 interface', () => {
  const command = webCommand();
  const probe =
    "const s=require('node:net').createServer();s.listen(0,'localhost',()=>{console.log(JSON.stringify(s.address()));s.close()})";
  const address = JSON.parse(
    execFileSync(command.file, [...command.args.slice(0, 1), '-e', probe], {
      encoding: 'utf8',
      timeout: 3000,
    }),
  );
  assert.equal(address.address, '127.0.0.1');
  assert.equal(address.family, 'IPv4');
});

function simulated() {
  const process = new EventEmitter();
  Object.assign(process, { exitCode: null, signalCode: null, kills: 0 });
  process.kill = () => {
    process.kills++;
    queueMicrotask(() => {
      process.signalCode = 'SIGTERM';
      process.emit('exit', null, 'SIGTERM');
    });
    return true;
  };
  return { process };
}

test('BF305 lifecycle: normal exit is already finished without another kill', async () => {
  const server = simulated();
  server.process.exitCode = 0;
  await stop(server);
  assert.equal(server.process.kills, 0);
});

test('BF305 lifecycle: normal exit event completes shutdown', async () => {
  const server = simulated();
  server.process.kill = () => {
    queueMicrotask(() => {
      server.process.exitCode = 0;
      server.process.emit('exit', 0, null);
    });
    return true;
  };
  await stop(server);
  assert.equal(server.process.exitCode, 0);
});

test('BF305 lifecycle: real signal termination leaves null exitCode and completes stop', async () => {
  const child = spawn(process.execPath, ['-e', "process.send('ready');setInterval(()=>{},1000)"], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    await once(child, 'message');
    await stop({ process: child }, 2000);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, 'SIGTERM');
    assert.equal(terminated(child), true);
  } finally {
    if (!terminated(child)) child.kill();
  }
});

test('BF305 lifecycle: already signal-exited is not killed or timed out', async () => {
  const server = simulated();
  server.process.signalCode = 'SIGTERM';
  await stop(server, 10);
  assert.equal(server.process.kills, 0);
});

test('BF305 lifecycle: concurrent and repeated stop signal once', async () => {
  const server = simulated();
  await Promise.all([stop(server), stop(server)]);
  await stop(server);
  assert.equal(server.process.kills, 1);
});

test('BF305 lifecycle: active non-terminating child alone reaches shutdown deadline', async () => {
  const server = simulated();
  server.process.kill = () => true;
  await assert.rejects(stop(server, 15), /remained active/);
  assert.equal(terminated(server.process), false);
});

test('BF305 lifecycle: spawn or kill failure is visible', async () => {
  const server = simulated();
  server.process.kill = () => false;
  await assert.rejects(stop(server), /termination failed/);
});

test('BF305 lifecycle: health failure still stops, resets, verifies and releases resources', async () => {
  const events = [];
  const server = simulated();
  await assert.rejects(async () => {
    try {
      events.push('start');
      throw new Error('health failed');
    } finally {
      await cleanup([
        [
          'stop',
          async () => {
            await stop(server);
            events.push('stop');
          },
        ],
        ['reset', () => events.push('reset')],
        ['baseline', () => events.push('baseline')],
        ['stack-stop', () => events.push('stack-stop')],
      ]);
    }
  }, /health failed/);
  assert.deepEqual(events, ['start', 'stop', 'reset', 'baseline', 'stack-stop']);
});

test('BF305 lifecycle: failed cleanup step does not suppress remaining steps or the failure', async () => {
  const events = [];
  await assert.rejects(
    cleanup([
      [
        'stop',
        () => {
          throw new Error('stop error');
        },
      ],
      ['reset', () => events.push('reset')],
      ['stack-stop', () => events.push('stack-stop')],
    ]),
    /cleanup failed: stop/,
  );
  assert.deepEqual(events, ['reset', 'stack-stop']);
});
