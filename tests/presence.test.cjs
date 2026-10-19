const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const {createApp}=require('../server.cjs');
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
test('Redis presence is shared across instances, deduplicates browsers and counts rolling 30 minutes',async t=>{
 let now=Date.now();const members=new Map();
 const redis=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-only-redis-token');
  let body='';for await(const c of req)body+=c;
  const [command,script,keys,key,id,window]=JSON.parse(body);
  if (key === 'tros:traffic:last:v1') { res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:Array(13).fill(0)}));return; }
  assert.equal(command,'EVAL');assert.equal(keys,1);assert.ok(script.includes("redis.call('TIME')"));assert.ok(script.includes("redis.call('ZCOUNT'"));assert.equal(key,'tros:presence:browsers:v1');
  for(const [id,seen] of members)if(seen<=now-1800000)members.delete(id);
  if(id){assert.match(id,/^[a-f0-9]{64}$/);members.set(id,now);}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({result:[[...members.values()].filter(n=>n>now-Number(window)).length,members.size]}));
 });const redisUrl=await listen(redis);t.after(()=>new Promise(r=>redis.close(r)));
 const env={VERCEL:'1',KV_REST_API_URL:redisUrl,KV_REST_API_TOKEN:'test-only-redis-token',ADMIN_PASSWORD:'test1234'};
 const apps=[];async function instance(){const a=createApp({env});apps.push(a);return listen(a.server);}t.after(async()=>{for(const a of apps)await a.close();});
 const one=await instance(),two=await instance();const id=crypto.randomUUID();
 async function touch(base,visitorId){return (await fetch(base+'/online',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({visitorId})})).json();}
 assert.equal((await touch(one,id)).online,1);assert.equal((await touch(two,id)).online,1);
 const second=crypto.randomUUID();assert.equal((await touch(two,second)).online,2);
 const restarted=await instance();const afterRestart=await (await fetch(restarted+'/online')).json();assert.equal(afterRestart.online,2);assert.equal(afterRestart.recentVisitors,2);assert.equal(afterRestart.presence.source,'redis');
 now+=91000;const expired=await(await fetch(one+'/online')).json();assert.equal(expired.online,0);assert.equal(expired.recentVisitors,2);
 assert.equal((await touch(two,id)).online,1);
 const adminText=await(await fetch(one+'/api/admin/status',{headers:{authorization:'Basic '+Buffer.from('admin:test1234').toString('base64')}})).text();const admin=JSON.parse(adminText);assert.equal(admin.activeSessions,1);assert.equal(admin.recentVisitors,2);assert.ok(!adminText.includes('test-only-redis-token'));assert.ok(!adminText.includes(redisUrl));
 now+=1800001;const gone=await(await fetch(restarted+'/online')).json();assert.equal(gone.online,0);assert.equal(gone.recentVisitors,0);
});
test('database failure returns unknown instead of a fake zero or instance count',async t=>{
 const redis=http.createServer((req,res)=>{res.writeHead(503);res.end();});const url=await listen(redis);t.after(()=>new Promise(r=>redis.close(r)));
 const a=createApp({env:{VERCEL:'1',UPSTASH_REDIS_REST_URL:url,UPSTASH_REDIS_REST_TOKEN:'not-public'}});const base=await listen(a.server);t.after(()=>a.close());
 const data=await(await fetch(base+'/online')).json();assert.equal(data.online,null);assert.equal(data.recentVisitors,null);assert.equal(data.presence.source,'unavailable');
});
