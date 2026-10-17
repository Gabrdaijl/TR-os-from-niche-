const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server.cjs');
async function app(t,env){const a=createApp({env});await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>a.close());return 'http://127.0.0.1:'+a.server.address().port;}
test('admin is disabled without a configured password of at least eight characters',async t=>{
 for(const env of [{},{ADMIN_PASSWORD:'short77'}]){const base=await app(t,env);assert.equal((await fetch(base+'/api/admin/status')).status,503);}
});
test('admin rejects anonymous, forged and cross-origin requests and never leaks secrets',async t=>{
 const password='test-only-password-12345';const base=await app(t,{ADMIN_PASSWORD:password,AI_KEY:'private-ai-secret',VERCEL:'1'});
 assert.equal((await fetch(base+'/api/admin/status')).status,401);
 assert.equal((await fetch(base+'/api/admin/status',{headers:{authorization:'Basic forged'}})).status,401);
 assert.equal((await fetch(base+'/api/admin/status',{method:'POST',headers:{origin:'https://other.invalid'}})).status,403);
 const response=await fetch(base+'/api/admin/status',{headers:{authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const text=await response.text();assert.ok(!text.includes(password));assert.ok(!text.includes('private-ai-secret'));
 const data=JSON.parse(text);assert.equal(data.activeSessions,0);assert.ok(data.scope.includes('serverinstans'));assert.ok(data.requests>=3);
});
test('admin throttles failed password attempts',async t=>{
 const base=await app(t,{ADMIN_PASSWORD:'test-only-password-12345'});for(let i=0;i<5;i++)assert.equal((await fetch(base+'/api/admin/status')).status,401);assert.equal((await fetch(base+'/api/admin/status')).status,429);
});
test('admin accepts an eight-character configured password',async t=>{
 const password='test1234'; const base=await app(t,{ADMIN_PASSWORD:password});
 const response=await fetch(base+'/api/admin/status',{headers:{authorization:'Basic '+Buffer.from('admin:'+password).toString('base64')}});
 assert.equal(response.status,200);
});
