'use strict';
const path = require('node:path');
const { createApp, proxyEnvironment } = require('../server.cjs');

// Export the HTTP server so Vercel can also forward WebSocket upgrades.
const app = createApp({
  root: path.join(__dirname, '..', 'public'),
  env: proxyEnvironment(process.env)
});
module.exports = app.server;
