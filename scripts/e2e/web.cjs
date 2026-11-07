const path = require('node:path');
const { root } = require('../../tests/e2e/helpers/environment.cjs');

function webCommand() {
  return {
    file: process.execPath,
    // Expo binds Metro to "localhost". Windows resolves ::1 first by default;
    // keep the approved IPv4-only manifest reachable without exposing a LAN listener.
    args: [
      '--dns-result-order=ipv4first',
      path.join(root, 'node_modules/expo/bin/cli'),
      'start',
      '--web',
      '--localhost',
      '--port',
      '8095',
    ],
  };
}

function webSpec(mode) {
  const dedicated = ['appointment-lifecycle', 'insufficient-stock', 'checkout', 'smoke'];
  const name = dedicated.includes(mode) ? mode : mode === 'auth' ? 'auth-session' : 'session';
  // Playwright treats CLI file filters as regexes, not exact basenames.
  return `(?:^|[\\\\/])${name}\\.spec\\.cjs$`;
}

module.exports = { webCommand, webSpec };
