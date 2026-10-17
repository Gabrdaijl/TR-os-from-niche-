'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../scripts/build-vercel.cjs');

test('Vercel build exposes only frontend assets and keeps runtime config dynamic', t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-os-build-'));
 t.after(() => fs.rmSync(root, { recursive:true, force:true }));
 for (const [name,content] of Object.entries({ 'index.html':'app', 'launcher.html':'launcher', 'launcher-catalog.js':'catalog', 'tr-os.config.js':'local-config', '.env':'secret', 'server.cjs':'server' })) fs.writeFileSync(path.join(root,name),content);
 for (const dir of ['scram','tests','api','node_modules']) { fs.mkdirSync(path.join(root,dir)); fs.writeFileSync(path.join(root,dir,'private.js'),'fixture'); }
 const {output}=build(root);
 assert.equal(fs.readFileSync(path.join(output,'index.html'),'utf8'),'app');
 assert.ok(fs.existsSync(path.join(output,'scram/private.js')));
 for (const name of ['tr-os.config.js','.env','server.cjs','api','tests','node_modules']) assert.ok(!fs.existsSync(path.join(output,name)),name);
 fs.writeFileSync(path.join(output,'stale.js'),'stale');
 build(root);
 assert.ok(!fs.existsSync(path.join(output,'stale.js')));
});

test('Vercel exports the same HTTP server for API routes and bundled static fallback', async t => {
 build();
 const server=require('../api/index.js');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await (await fetch(base+'/api/health')).json()).name,'TR-os');
 assert.match(await (await fetch(base+'/launcher.html')).text(),/launcher-catalog.js/);
 assert.match(await (await fetch(base+'/tr-os.config.js')).text(),/hasBackend/);
 for (const route of ['/api/index.js','/scripts/build-vercel.cjs','/.env','/server.cjs']) assert.equal((await fetch(base+route)).status,404);
 assert.ok(server.listenerCount('upgrade')>0);
});
