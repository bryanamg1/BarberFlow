const fs = require('node:fs');
const path = require('node:path');
const { privateRoot, manifest, root } = require('./environment.cjs');

function sanitize(text, secrets = []) {
  let value = String(text).replace(/\u001b\[[0-9;]*m/g, '');
  for (const secret of secrets.filter(Boolean)) value = value.split(secret).join('[redacted]');
  if (
    /authorization|cookie|password|access.token|refresh.token|verifier|pkce|service.role|fill\(/i.test(
      value,
    )
  )
    return '[sensitive line omitted]';
  value = value.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]');
  value = value.replace(/https?:\/\/[^\s"<>]+/g, (raw) => {
    try {
      const url = new URL(raw);
      if (![manifest.baseUrl, manifest.supabaseUrl, 'http://localhost:8095'].includes(url.origin))
        return '[external URL omitted]';
      return url.origin + url.pathname;
    } catch {
      return '[URL omitted]';
    }
  });
  return value.slice(0, 500);
}

function writeDiagnostic(directory, snapshot, secrets = []) {
  if (!path.resolve(directory).startsWith(path.join(privateRoot, 'runs') + path.sep))
    throw new Error('Unsafe diagnostic destination');
  const output = {
    timestamp: new Date().toISOString(),
    cwd: root,
    host: '127.0.0.1',
    port: 8095,
    healthUrl: manifest.baseUrl,
    command: snapshot.command.map((part) => sanitize(part, secrets)),
    exitCode: snapshot.exitCode,
    signalCode: snapshot.signalCode,
    stdout: snapshot.stdout.slice(-40).map((line) => sanitize(line, secrets)),
    stderr: snapshot.stderr.slice(-40).map((line) => sanitize(line, secrets)),
  };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'web-process.json'),
    JSON.stringify(output, null, 2) + '\n',
  );
}

function redactTestError(error, secrets) {
  for (const key of ['message', 'stack']) {
    if (typeof error[key] === 'string') {
      error[key] = error[key]
        .split('\n')
        .map((line) => sanitize(line, secrets))
        .join('\n');
    }
  }
  delete error.errorContext;
}

module.exports = { sanitize, writeDiagnostic, redactTestError };
