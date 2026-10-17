'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { WebSocketServer, WebSocket } = require('ws');
const { server: wisp } = require('@mercuryworkshop/wisp-js/server');

function proxyEnvironment(source) {
  const env = { ...source };
  env.PROXY_PROVIDER ||= 'direct';
  if (env.PROXY_PROVIDER === 'reference') {
    env.PROXY_PROVIDER = 'reference';
    env.PROXY_WISP_URL ||= 'wss://t9os.space/wisp-vps/';
    env.VPN_WISP_URL ||= 'wss://t9os.space/wisp-mullvad/';
    env.VPN_API_URL ||= 'https://t9os.space';
    env.CLOUD_API_URL ||= 'https://t9os.space';
  }
  return env;
}

function createApp(options = {}) {
  const root = options.root || __dirname;
  const env = options.env || process.env;
  const sessions = new Map(), messages = [], limits = new Map();
  const sockets = new Set();
  let lastStamp = Date.now();
  const startedAt = Date.now();
  let requestCount = 0, serverErrors = 0;
  const nowStamp = () => lastStamp = Math.max(Date.now(), lastStamp + 1);
  const activeCount = () => [...sessions.values()].filter(s => Date.now() - s.seen < 45000).length;
  const json = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  function authenticated(token, secret) {
    const user = sessions.get(token);
    if (!user || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return null;
    return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(user.secret)) ? user : null;
  }
  async function body(req, maxBytes = 1024 * 1024) {
    let length = 0, chunks = [];
    for await (const chunk of req) {
      length += chunk.length;
      if (length > maxBytes) throw Object.assign(new Error('Request is too large'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
      return value;
    }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  function allowed(req, bucket = 'general', maximum = 300) {
    const key = bucket + ':' + req.socket.remoteAddress;
    let limit = limits.get(key);
    if (!limit || limit.until < Date.now()) limits.set(key, limit = { n: 0, until: Date.now() + 60000 });
    return ++limit.n <= maximum;
  }
  function broadcast() {
    const message = JSON.stringify({ online: activeCount() });
    for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
  async function relay(res, url, init = {}) {
    const upstream = await fetch(url, { ...init, signal: AbortSignal.timeout(90000), redirect: 'error' });
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    if (!upstream.body) return res.end();
    const stream = Readable.fromWeb(upstream.body);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
  function configuredUrl(base, suffix) {
    const url = new URL(base.replace(/\/$/, '') + suffix);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported service URL');
    return url;
  }
  async function handler(req, res) {
    requestCount++;
    res.once('finish', () => { if (res.statusCode >= 500) serverErrors++; });
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (mutating && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Origin is not allowed' });
    const apiRequest = /^\/(?:api\/|chat\/|cloud\/|online(?:$|\/))/.test(route);
    if (apiRequest && !allowed(req)) return json(res, 429, { error: 'Too many requests; try again shortly' });
    if (route === '/api/admin/status') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Use GET' });
      if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8) return json(res, 503, { error: 'Admin är låst. Sätt ADMIN_PASSWORD (minst 8 tecken) som Sensitive i Vercel och publicera igen.' });
      const supplied = req.headers.authorization || '';
      const expected = 'Basic ' + Buffer.from('admin:' + env.ADMIN_PASSWORD).toString('base64');
      const digest = value => crypto.createHash('sha256').update(value).digest();
      if (!crypto.timingSafeEqual(digest(supplied), digest(expected))) {
        if (!allowed(req, 'admin-login', 5)) return json(res, 429, { error: 'För många försök. Vänta en minut.' });
        return json(res, 401, { error: 'Fel lösenord eller utloggad.' });
      }
      return json(res, 200, {
        checkedAt: new Date().toISOString(), startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        activeSessions: activeCount(), websocketConnections: sockets.size,
        requests: requestCount, serverErrors, memoryMB: Math.round(process.memoryUsage().rss / 1048576),
        scope: 'Denna serverinstans. Sessioner är inte unika personer. Vercel kan köra flera instanser och nollställa räknarna vid omstart.',
        services: {
          server: 'Tillgänglig', proxy: 'Egen Wisp-server aktiverad; externa mål kan neka åtkomst',
          ai: env.AI_URL ? 'Eget server-API konfigurerat; svar inte verifierat här' : 'Lokal AI och offentligt externt AI-alternativ i chatten',
          vpn: env.VPN_API_URL && env.VPN_WISP_URL ? 'VPN-backend konfigurerad; tunnel inte verifierad här' : 'Ingen egen VPN-tunnel ansluten',
          movies: env.TMDB_KEY ? 'Filmmetadata konfigurerad; uppspelning beror på extern källa' : 'Ingen egen TMDB-nyckel konfigurerad',
          cloud: 'Extern Cloud-spelare; ingen egen spelserver', chat: 'Egen chatt och närvaro aktiverad'
        }
      });
    }
    if (route === '/api/health') return json(res, 200, {
      ok: true, name: 'TR-os', services: {
        proxy: true, chat: true, online: true,
        ai: env.AI_URL ? 'remote' : env.VERCEL ? 'unconfigured' : 'local-ollama', cloud: !!env.CLOUD_API_URL,
        vpn: !!env.VPN_API_URL && !!env.VPN_WISP_URL, cheats: !!env.JOIN_URL
      }
    });
    if (route === '/tr-os.config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end('window.TR_OS_CONFIG = ' + JSON.stringify({ apiBase: '', wispBase: '', aiUrl: '/api/ai', hasBackend: true, cloudKeyOnServer: !!env.CLOUD_API_KEY, cloudConfigured: !!env.CLOUD_API_URL, vpnConfigured: !!env.VPN_API_URL && !!env.VPN_WISP_URL, proxyProvider: env.PROXY_PROVIDER || (env.PROXY_WISP_URL ? 'custom' : 'direct') }) + ';');
    }
    if (route === '/online') {
      if (req.method === 'GET') return json(res, 200, { online: activeCount() });
      if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST' });
      const data = await body(req);
      let user = authenticated(data.token, data.secret);
      if (data.leave) return json(res, 200, { online: activeCount() });
      if (!user) {
        if (sessions.size >= 10000) return json(res, 503, { error: 'Server is busy' });
        const token = crypto.randomUUID();
        user = { token, secret: crypto.randomBytes(32).toString('hex'), name: 'Guest ' + token.slice(0, 4), seen: Date.now() };
        sessions.set(token, user);
      }
      user.seen = Date.now();
      broadcast();
      return json(res, 200, { token: user.token, secret: user.secret, online: activeCount(), banned: false });
    }
    if (route === '/chat/room' && req.method === 'GET') return json(res, 200, { messages: messages.filter(m => m.to === 'all' && m.ts > Number(url.searchParams.get('since') || 0)).slice(-100) });
    if (route === '/chat/inbox' && req.method === 'GET') {
      const user = authenticated(url.searchParams.get('token'), url.searchParams.get('secret'));
      if (!user) return json(res, 401, { error: 'Session expired; reload the page' });
      return json(res, 200, { messages: messages.filter(m => m.to === user.token && m.ts > Number(url.searchParams.get('since') || 0)).slice(-100) });
    }
    if (route === '/chat/send' && req.method === 'POST') {
      const data = await body(req), user = authenticated(data.from, data.secret);
      if (!user) return json(res, 401, { error: 'Session expired; reload the page' });
      if (!allowed(req, 'chat', 30)) return json(res, 429, { error: 'Please wait before sending more messages' });
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 4000 || (data.to !== 'all' && !sessions.has(data.to))) return json(res, 400, { error: 'Invalid message or recipient' });
      const message = { id: crypto.randomUUID(), from: user.token, fromName: user.name, to: data.to, text, ts: nowStamp() };
      messages.push(message);
      if (messages.length > 1000) messages.shift();
      return json(res, 200, { ok: true, id: message.id });
    }
    if (route === '/party') return json(res, 200, { disco: false, track: null, bg: null });
    if (route === '/suggest' && req.method === 'GET') {
      const query = (url.searchParams.get('q') || '').slice(0, 200);
      if (!query) return json(res, 200, { list: [] });
      try {
        const response = await fetch('https://ac.duckduckgo.com/ac/?q=' + encodeURIComponent(query) + '&type=list', { signal: AbortSignal.timeout(4000) });
        const suggestions = await response.json();
        const list = Array.isArray(suggestions[1]) ? suggestions[1] : suggestions.map(item => item.phrase).filter(Boolean);
        return json(res, 200, { list: list.slice(0, 8) });
      } catch { return json(res, 200, { list: [] }); }
    }
    if (route === '/chat/log' || route === '/api/mullvad/log') { res.writeHead(204); return res.end(); }
    if (route === '/api/redeem/verify') return json(res, 200, { valid: false, unlimited: false });
    if (route === '/api/ai' || route === '/api/nvidia/chat') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
      if (!allowed(req, 'ai', 15)) return json(res, 429, { error: 'Please wait before sending more requests' });
      const data = await body(req, 8 * 1024 * 1024);
      const validContent = content => typeof content === 'string' || (Array.isArray(content) && content.length <= 32 && content.every(part => part && (part.type === 'text' ? typeof part.text === 'string' : part.type === 'image_url' && typeof part.image_url?.url === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(part.image_url.url))));
      if (!Array.isArray(data.messages) || data.messages.length > 100 || data.messages.some(m => !['user', 'assistant', 'system'].includes(m.role) || !validContent(m.content))) return json(res, 400, { error: 'Invalid chat messages' });
      if (env.AI_URL) return relay(res, configuredUrl(env.AI_URL, ''), { method: 'POST', headers: { 'content-type': 'application/json', ...(env.AI_KEY ? { authorization: 'Bearer ' + env.AI_KEY } : {}) }, body: JSON.stringify({ model: env.AI_MODEL || data.model, messages: data.messages, stream: !!data.stream }) });
      if (env.VERCEL) return json(res, 503, { error: 'AI är inte ansluten ännu. En AI-tjänst behöver konfigureras för TR-os i Vercel.' });
      // Ollama runs locally; request a regular OpenAI-compatible response for
      // the frontend's non-stream fallback. No simulated AI replies are used.
      try {
        const localMessages = data.messages.map(message => Array.isArray(message.content) ? {
          role: message.role,
          content: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'),
          images: message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url.split(',')[1])
        } : message);
        const upstream = await fetch(configuredUrl(env.OLLAMA_URL || 'http://127.0.0.1:11434', '/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: env.OLLAMA_MODEL || 'llama3.2', messages: localMessages, stream: false }), signal: AbortSignal.timeout(90000) });
        const result = await upstream.json();
        if (!upstream.ok) return json(res, 503, { error: result.error || 'Local AI model is unavailable' });
        return json(res, 200, { choices: [{ message: { role: 'assistant', content: result.message?.content || '' } }] });
      } catch { return json(res, 503, { error: 'Connect an AI service or start Ollama with the configured model.' }); }
    }
    if (route === '/api/cloud/status') {
      if (!env.CLOUD_API_URL) return json(res, 200, { configured: false, available: false, keyRequired: false });
      let available = false;
      try {
        const response = await fetch(configuredUrl(env.CLOUD_API_URL, '/cloud/v1/'), { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000) });
        available = response.status < 500;
        await response.body?.cancel();
      } catch {}
      return json(res, 200, { configured: true, available, keyRequired: !env.CLOUD_API_KEY });
    }
    if (route.startsWith('/cloud/v1/')) {
      if (!env.CLOUD_API_URL) return json(res, 503, { error: 'Connect your cloud-gaming provider to start a session.' });
      const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
      const key = env.CLOUD_API_KEY || req.headers['x-api-key'];
      if (key) headers['x-api-key'] = key;
      try {
        return await relay(res, configuredUrl(env.CLOUD_API_URL, route + url.search), { method: req.method, headers, ...(mutating ? { body: JSON.stringify(await body(req)) } : {}) });
      } catch (error) {
        if (error.status) throw error;
        return json(res, 503, { error: 'The cloud service could not be reached. Please try again later.' });
      }
    }
    if (route.startsWith('/api/mullvad/')) {
      if (env.VPN_API_URL) return relay(res, configuredUrl(env.VPN_API_URL, route + url.search), { method: req.method, headers: { 'content-type': 'application/json' }, ...(mutating ? { body: JSON.stringify(await body(req)) } : {}) });
      if (route.endsWith('/relays')) return json(res, 200, { relays: [], active: 'vps', vpn: false });
      if (route.endsWith('/status')) return json(res, 200, { relay: 'vps', vpn: false, city: '', country: 'Direct proxy', exit_ip: null });
      return json(res, 503, { error: 'No VPN service connected. Direct proxy is available.' });
    }
    if (route.startsWith('/api/tmdb-img/')) return relay(res, 'https://image.tmdb.org/' + route.slice('/api/tmdb-img/'.length) + url.search);
    if (route.startsWith('/api/tmdb/')) {
      const target = new URL('https://api.themoviedb.org/3/' + route.slice('/api/tmdb/'.length) + url.search);
      if (env.TMDB_API_KEY) target.searchParams.set('api_key', env.TMDB_API_KEY);
      return relay(res, target);
    }
    if (route === '/join' || route === '/join/') {
      if (env.JOIN_URL) { res.writeHead(302, { location: configuredUrl(env.JOIN_URL, '').href }); return res.end(); }
      res.writeHead(302, { location: '/cheats.html' });
      return res.end();
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method is not allowed' });
    let decoded;
    try { decoded = decodeURIComponent(route); } catch { return json(res, 400, { error: 'Invalid path' }); }
    if (decoded.split(/[\\/]/).some(part => part.startsWith('.') || ['node_modules', 'data', 'tests', 'api', 'scripts'].includes(part))) return json(res, 404, { error: 'Not found' });
    let file = path.resolve(root, '.' + decoded);
    if (!file.startsWith(root + path.sep) && file !== root) return json(res, 404, { error: 'Not found' });
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { return json(res, 404, { error: 'Not found' }); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.cur': 'image/x-icon', '.ani': 'application/octet-stream', '.woff2': 'font/woff2' };
    const type = types[path.extname(file)];
    if (!type || !fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', ...(file.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  const server = http.createServer((req, res) => handler(req, res).catch(error => {
    if (res.headersSent) return res.destroy();
    json(res, error.status || 502, { error: error.status ? error.message : 'The connected service could not be reached.' });
  }));
  const chatWs = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const proxyWs = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  chatWs.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.send(JSON.stringify({ online: activeCount() }));
    socket.on('message', message => {
      if (message.toString() === 'ping') socket.send(JSON.stringify({ online: activeCount() }));
    });
  });
  wisp.options.allow_private_ips = false;
  wisp.options.allow_loopback_ips = false;
  wisp.options.port_whitelist = [80, 443];
  function relayWisp(req, socket, head, target) {
    const upstream = new WebSocket(target);
    const timer = setTimeout(() => { upstream.terminate(); socket.destroy(); }, 10000);
    socket.once('close', () => upstream.terminate());
    upstream.on('error', () => { clearTimeout(timer); socket.destroy(); });
    upstream.on('open', () => {
      clearTimeout(timer);
      proxyWs.handleUpgrade(req, socket, head, client => {
        sockets.add(client);
        client.on('message', (data, binary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary }); });
        upstream.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
        client.on('close', () => { sockets.delete(client); upstream.close(); });
        client.on('error', () => upstream.close());
        upstream.on('close', () => client.close());
      });
    });
  }
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return socket.destroy(); }
      catch { return socket.destroy(); }
    }
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/tros-ws') return chatWs.handleUpgrade(req, socket, head, ws => chatWs.emit('connection', ws, req));
    // Movie playback must not depend on the reference site's VPN being online.
    if (route === '/wisp-movies/') return wisp.routeRequest(req, socket, head);
    if (route === '/wisp-vps/') {
      if (env.PROXY_WISP_URL) return relayWisp(req, socket, head, env.PROXY_WISP_URL);
      return wisp.routeRequest(req, socket, head);
    }
    if (/^\/wisp-mullvad(?:-(?:us|eu|se))?\/$/.test(route) && env.VPN_WISP_URL) {
      return relayWisp(req, socket, head, env.VPN_WISP_URL);
    }
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
  });
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, value] of sessions) if (value.seen < cutoff) sessions.delete(key);
    for (const [key, value] of limits) if (value.until < Date.now()) limits.delete(key);
    while (messages.length && messages[0].ts < cutoff) messages.shift();
  }, 60000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); chatWs.close(); proxyWs.close(); });
  return { server, close: () => { for (const socket of sockets) socket.terminate(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

function start() {
  if (typeof process.loadEnvFile === 'function') { try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const app = createApp({ env: proxyEnvironment(process.env) });
  app.server.listen(Number(process.env.PORT || 8173), process.env.HOST || '127.0.0.1', () => console.log('TR-os: http://localhost:' + app.server.address().port));
  return app;
}
module.exports = { createApp, start, proxyEnvironment };
if (require.main === module) start();
