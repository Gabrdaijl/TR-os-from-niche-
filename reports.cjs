'use strict';
const crypto = require('node:crypto');
const { createRedisStorage } = require('./redis-storage.cjs');
const RETENTION = 7 * 24 * 60 * 60;
const PREFIX = '{tros:reports}:v1:';
const ARCHIVE_RETENTION = 30 * 24 * 60 * 60;
const CATEGORIES = ['home', 'games', 'movies', 'ai', 'browser', 'snapchat', 'cloud', 'other'];
const fail = (status, message) => Object.assign(new Error(message), {status});
function imageBytes(image) {
  if (image === undefined || image === null || image === '') return null;
  if (typeof image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length > 140000) throw fail(400, 'Bilden måste vara en JPEG-bild på högst 100 kB.');
  const encoded = image.slice('data:image/jpeg;base64,'.length), bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > 102400 || bytes.toString('base64') !== encoded || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw fail(400, 'Bilden är ogiltig.');
  let offset = 2, dimensions = false;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([192, 193, 194].includes(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > 1280 || height > 1280 || width * height > 1638400) throw fail(400, 'Bilden är för stor.');
      dimensions = true;
    }
    offset += length;
  }
  if (!dimensions) throw fail(400, 'Bilden kunde inte läsas.');
  return bytes;
}
const CREATE = `-- tr-os:reports:create
local now=tonumber(redis.call('TIME')[1])
if redis.call('EXISTS',ARGV[1]..'meta')==1 then return {2,now*1000} end
if tonumber(redis.call('GET',KEYS[2]) or '0')>=30 or tonumber(redis.call('GET',KEYS[3]) or '0')>=3 then return {0} end
local report=cjson.decode(ARGV[2]); report.createdAt=now*1000
redis.call('SET',ARGV[1]..'meta',cjson.encode(report),'EX',ARGV[4])
if ARGV[3]~='' then redis.call('SET',ARGV[1]..'image',ARGV[3],'EX',ARGV[4]) end
redis.call('ZADD',KEYS[1],now,ARGV[1]); redis.call('EXPIRE',KEYS[1],ARGV[4])
local old=redis.call('ZRANGEBYSCORE',KEYS[1],'-inf',now-tonumber(ARGV[4]))
for _,id in ipairs(old) do redis.call('DEL',id..'meta',id..'image'); redis.call('ZREM',KEYS[1],id) end
local extra=redis.call('ZCARD',KEYS[1])-50
if extra>0 then
 local evicted=redis.call('ZRANGE',KEYS[1],0,extra-1)
 for _,id in ipairs(evicted) do redis.call('DEL',id..'meta',id..'image'); redis.call('ZREM',KEYS[1],id) end
end
for i=2,3 do local count=redis.call('INCR',KEYS[i]); if count==1 then redis.call('EXPIRE',KEYS[i],600) end end
return {1,now*1000}`;
const LIST = `-- tr-os:reports:list
local now=tonumber(redis.call('TIME')[1]); redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-tonumber(ARGV[1]))
local ids=redis.call('ZREVRANGE',KEYS[1],0,49); local reports={}
for _,id in ipairs(ids) do local item=redis.call('GET',id..'meta'); if item then table.insert(reports,item) end end
return reports`;
const ARCHIVE = `-- tr-os:reports:archive
local id=ARGV[1]; local now=tonumber(redis.call('TIME')[1]); local item=redis.call('GET',id..'meta')
if not item then return 0 end
local ttl=tonumber(ARGV[2]); local archivedId=ARGV[3]..id
redis.call('SET',archivedId..'meta',item,'EX',ttl)
local image=redis.call('GET',id..'image'); if image then redis.call('SET',archivedId..'image',image,'EX',ttl) end
redis.call('ZREM',KEYS[1],id); redis.call('DEL',id..'meta',id..'image')
redis.call('ZADD',KEYS[2],now,archivedId); redis.call('EXPIRE',KEYS[2],ttl)
local extra=redis.call('ZCARD',KEYS[2])-1000
if extra>0 then local old=redis.call('ZRANGE',KEYS[2],0,extra-1); for _,entry in ipairs(old) do redis.call('DEL',entry..'meta',entry..'image'); redis.call('ZREM',KEYS[2],entry) end end
return 1`;
function createReports(env, request = fetch) {
  const storage = createRedisStorage(env, request);
  const { endpoint, token } = storage;
  async function redis(command) {
    if (!storage.configured) throw fail(503, 'Felrapporteringen är inte ansluten till databasen ännu.');
    try {
      const response = await storage.request(endpoint, {method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw Error();
      const data = await response.json(); if (data.error) throw Error(); return data.result;
    } catch { throw fail(503, 'Rapporten kunde inte sparas just nu. Försök igen senare.'); }
  }
  return {
    async submit(data) {
      if (typeof data.message !== 'string' || data.message.trim().length < 5 || data.message.length > 2000 || !CATEGORIES.includes(data.category) || typeof data.clientId !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.clientId)) throw fail(400, 'Välj en del av sidan och beskriv felet med 5–2000 tecken.');
      if(data.requestId!==undefined && (typeof data.requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(data.requestId)))throw fail(400,'Ogiltigt rapport-ID.');
      const image = imageBytes(data.image);
      const hash=data.requestId?crypto.createHash('sha256').update(data.clientId+'|'+data.requestId).digest('hex').slice(0,32):null;
      const id=hash?[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20)].join('-'):crypto.randomUUID();
      const client = crypto.createHash('sha256').update(data.clientId).digest('hex');
      const result = await redis(['EVAL',CREATE,3,PREFIX+'index',PREFIX+'rate:all',PREFIX+'rate:'+client,PREFIX+id+':',JSON.stringify({id,message:data.message.trim(),category:data.category,hasImage:!!image}),image ? image.toString('base64') : '',RETENTION]);
      if (!Array.isArray(result) || ![1,2].includes(result[0])) throw fail(429, 'För många rapporter just nu. Vänta tio minuter och försök igen.');
      return {id,createdAt:result[1]};
    },
    async list() {
      const values = await redis(['EVAL',LIST,1,PREFIX+'index',RETENTION]);
      if (!Array.isArray(values)) throw fail(503, 'Rapporterna kunde inte hämtas.');
      return {reports:values.map(value=>JSON.parse(value)),retentionDays:7,maximum:50};
    },
    async archive(id) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw fail(404, 'Rapporten finns inte.');
      const result = await redis(['EVAL',ARCHIVE,2,PREFIX+'index',PREFIX+'archive:index',PREFIX+id+':',ARCHIVE_RETENTION,PREFIX+'archive:']);
      if (Number(result) !== 1) throw fail(404, 'Rapporten finns inte längre.');
      return { archived: true };
    },
    async image(id) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw fail(404, 'Bilden finns inte.');
      const value = await redis(['GET',PREFIX+id+':image']);
      if (!value) throw fail(404, 'Bilden finns inte längre.');
      return Buffer.from(value,'base64');
    }
  };
}
module.exports = {createReports,imageBytes,RETENTION,ARCHIVE_RETENTION};
