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

module.exports = { webCommand };
