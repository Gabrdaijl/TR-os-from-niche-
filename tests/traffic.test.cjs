const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTraffic,midnightStockholm}=require('../traffic.cjs');
test('Stockholm calendar boundaries handle summer, winter and clock change days',()=>{
 for(const [date,expected] of [
 ['2026-10-19T12:00:00Z','2026-10-18T22:00:00Z'],
 ['2026-12-19T12:00:00Z','2026-12-18T23:00:00Z'],
 ['2026-10-25T12:00:00Z','2026-10-24T22:00:00Z'],
 ['2026-03-29T12:00:00Z','2026-03-28T23:00:00Z']
 ]) assert.equal(midnightStockholm(new Date(date)),Date.parse(expected));
});
test('traffic sends hashed browser IDs and a stable document ID, returns separate periods',async()=>{
 const id='12345678-1234-4234-8234-123456789012';
 let command;
 const traffic=createTraffic({KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'private'},async(url,init)=>{
  command=JSON.parse(init.body);assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer private');
  return {ok:true,json:async()=>({result:[1,2,1,3,7,2,9,12,5,20,40,20,1792411200000]})};
 });
 const data=await traffic.snapshot(id,id);
 assert.equal(command[2],6);assert.match(command[9],/^[a-f0-9]{64}$/);assert.notEqual(command[9],id);assert.equal(command[10],id);
 assert.deepEqual(data.today,{visitors:1,pageViews:2,newBrowsers:1});assert.deepEqual(data.week,{visitors:3,pageViews:7,newBrowsers:2});assert.equal(data.month.visitors,9);
 assert.deepEqual(data.allTime,{visitors:20,pageViews:40,newBrowsers:20,approximate:true,startedAt:1792411200000});
 assert.deepEqual(command.slice(6,9),['tros:traffic:lifetime:browsers:v1','tros:traffic:lifetime:views:v1','tros:traffic:lifetime:since:v1']);
});
test('traffic is unknown on missing configuration, rejected HTTP or malformed Redis data',async()=>{
 const missing=await createTraffic({}).snapshot();assert.equal(missing.today,null);assert.equal(missing.allTime,null);
 for(const result of [{ok:false},{ok:true,json:async()=>({result:[0]})},{ok:true,json:async()=>({result:Array(13).fill(-1)})},{ok:true,json:async()=>({error:'private provider error'})}]){
  const data=await createTraffic({KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'private'},async()=>result).snapshot();
  assert.equal(data.source,'unavailable');assert.equal(data.today,null);assert.equal(data.allTime,null);assert.ok(!JSON.stringify(data).includes('private'));
 }
});

test('read-only empty lifetime remains zero without inventing a collection start date',async()=>{
 let command;
 const traffic=createTraffic({KV_REST_API_URL:'https://redis.example',KV_REST_API_TOKEN:'private'},async(url,init)=>{
  command=JSON.parse(init.body);return {ok:true,json:async()=>({result:Array(13).fill(0)})};
 });
 const data=await traffic.snapshot('invalid','invalid');
 assert.deepEqual(command.slice(9,11),['','']);
 assert.deepEqual(data.allTime,{visitors:0,pageViews:0,newBrowsers:0,approximate:true,startedAt:null});
});
