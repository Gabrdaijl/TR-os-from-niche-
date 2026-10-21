'use strict';
const crypto = require('node:crypto');
const { createRedisCircuit, classifyFailure } = require('./redis-circuit.cjs');
// One atomic operation: heartbeat, deduplicated document view and rolling counts.
// Lifetime HyperLogLogs retain deduplication after the rolling keys expire,
// without storing an unbounded set of browser/document IDs. Counts are estimates.
const SCRIPT = `local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local day=86400000
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-30*day)
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now-30*day)
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now-30*day)
if ARGV[1]~='' then
 redis.call('SET',KEYS[6],now,'NX')
 redis.call('PFADD',KEYS[4],ARGV[1])
 if not redis.call('ZSCORE',KEYS[1],ARGV[1]) then redis.call('ZADD',KEYS[3],now,ARGV[1]) end
 redis.call('ZADD',KEYS[1],now,ARGV[1])
 if ARGV[2]~='' then
  local document=ARGV[1]..':'..ARGV[2]
  redis.call('ZADD',KEYS[2],'NX',now,document)
  redis.call('PFADD',KEYS[5],document)
 end
 for i=1,3 do redis.call('EXPIRE',KEYS[i],2678400) end
end
local result={}
for _,cutoff in ipairs({tonumber(ARGV[3]),now-7*day,now-30*day}) do
 for i=1,3 do table.insert(result,redis.call('ZCOUNT',KEYS[i],'('..cutoff,'+inf')) end
end
local browsers=redis.call('PFCOUNT',KEYS[4])
table.insert(result,browsers)
table.insert(result,redis.call('PFCOUNT',KEYS[5]))
table.insert(result,browsers)
table.insert(result,tonumber(redis.call('GET',KEYS[6])) or 0)
return result`;
function midnightStockholm(now = new Date()) {
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const utc = Date.parse(date+'T00:00:00Z');
  const hour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',hourCycle:'h23'}).format(new Date(utc)));
  return utc-hour*3600000;
}
function createTraffic(env, request = fetch, redisCircuit = createRedisCircuit()) {
  const url=env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token=env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  async function snapshot(visitorId, viewId) {
    const empty={source:url&&token?'unavailable':'unconfigured',today:null,week:null,month:null,allTime:null};
    if(!url || !token)return empty;
    if(redisCircuit.isOpen())return empty;
    let failureReason='upstream_unavailable';
    try {
      const endpoint=new URL(url);
      if(endpoint.protocol!=='https:' && !(endpoint.protocol==='http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname)))return empty;
      const valid=value=>typeof value==='string' && /^[a-f0-9-]{36}$/i.test(value);
      const id=valid(visitorId)?crypto.createHash('sha256').update(visitorId).digest('hex'):'';
      const response=await request(endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},signal:AbortSignal.timeout(4500),body:JSON.stringify(['EVAL',SCRIPT,6,'tros:traffic:last:v1','tros:traffic:views:v1','tros:traffic:new:v1','tros:traffic:lifetime:browsers:v1','tros:traffic:lifetime:views:v1','tros:traffic:lifetime:since:v1',id,valid(viewId)?viewId:'',midnightStockholm()])});
      if(!response.ok){let message='';try{message=(await response.text()).slice(0,2048)}catch{}failureReason=classifyFailure(message);if(failureReason==='upstream_error')failureReason='upstream_unavailable';if(Number.isInteger(response.status))failureReason+='_http_'+response.status;throw Error('Redis unavailable');}
      const data=await response.json();
      if(data.error){failureReason=classifyFailure(data.error);if(failureReason==='upstream_error')failureReason='redis_command_error';throw Error('Redis command failed');}
      if(!Array.isArray(data.result) || data.result.length!==13 || data.result.some(n=>!Number.isSafeInteger(n)||n<0)){failureReason='invalid_response';throw Error('Invalid Redis result');}
      redisCircuit.recordSuccess();
      const period=i=>({visitors:data.result[i],pageViews:data.result[i+1],newBrowsers:data.result[i+2]});
      return {source:'redis',today:period(0),week:period(3),month:period(6),allTime:{...period(9),approximate:true,startedAt:data.result[12] || null}};
    } catch { redisCircuit.recordFailure(failureReason);console.warn('[traffic-storage] Redis REST failure',{reason:failureReason});return empty; }
  }
  return {snapshot};
}
module.exports={createTraffic,midnightStockholm,SCRIPT};
