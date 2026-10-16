const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createApp } = require('../server.cjs');

async function exchange(hostname, sendHttp) {
  const app = createApp({ env: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/wisp-vps/');
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Wisp stream timed out')), 12000);
      let started = false, response = '';
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
      socket.on('error', error => finish(error));
      socket.on('message', raw => {
        const data = Buffer.from(raw), type = data[0], id = data.readUInt32LE(1);
        if (!started && type === 3 && id === 0) {
          started = true;
          const host = Buffer.from(hostname), connect = Buffer.alloc(8 + host.length);
          connect[0] = 1; connect.writeUInt32LE(1, 1); connect[5] = 1; connect.writeUInt16LE(80, 6); host.copy(connect, 8);
          socket.send(connect);
          if (sendHttp) {
            const request = Buffer.from('GET / HTTP/1.1\r\nHost: ' + hostname + '\r\nConnection: close\r\n\r\n');
            const packet = Buffer.alloc(5 + request.length); packet[0] = 2; packet.writeUInt32LE(1, 1); request.copy(packet, 5); socket.send(packet);
          }
        }
        if (type === 2 && id === 1) {
          response += data.subarray(5).toString();
          if (response.includes('\r\n\r\n')) finish(null, { response });
        }
        if (type === 4 && id === 1) finish(sendHttp ? new Error('Proxy stream closed without HTTP response') : null, { blocked: true });
      });
    });
    assert.equal((await fetch(base + '/api/health')).status, 200, 'server must remain available after a real stream');
    return result;
  } finally {
    socket.terminate();
    await app.close();
  }
}
test('Wisp blocks private destinations without stopping the server', async () => {
  assert.equal((await exchange('127.0.0.1', false)).blocked, true);
});
test('outbound Wisp stream returns real HTTP bytes', { skip: process.env.TR_OS_NETWORK_TEST !== '1' }, async () => {
  const result = await exchange('example.com', true);
  assert.match(result.response, /^HTTP\/1\.[01] \d{3}/);
});
