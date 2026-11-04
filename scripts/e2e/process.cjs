const stopping = new WeakMap();

function terminated(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function stop(server, timeoutMs = 10000) {
  if (!server || terminated(server.process)) return Promise.resolve();
  const child = server.process;
  if (stopping.has(child)) return stopping.get(child);
  const completion = new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = () => finish(new Error('E2E process termination failed'));
    const timer = setTimeout(() => {
      if (terminated(child)) finish();
      else finish(new Error('E2E process remained active after shutdown deadline'));
    }, timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
    // Register listeners before signalling, including synchronous test/event races.
    try {
      if (!child.kill('SIGTERM') && !terminated(child)) onError();
    } catch {
      onError();
    }
  });
  stopping.set(child, completion);
  return completion;
}

async function cleanup(steps) {
  const failures = [];
  for (const [name, action] of steps) {
    try {
      await action();
    } catch {
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`E2E cleanup failed: ${failures.join(', ')}`);
}

module.exports = { stop, terminated, cleanup };
