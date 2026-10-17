const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('failed movie sources never switch without a user action',()=>{
 const source=fs.readFileSync(require.resolve('../nm.js'),'utf8');
 const code=source.slice(source.indexOf('  function failedPlayerSource('),source.indexOf('  async function changePlayerSource('));
 const frame={style:{},src:'failed'}; const sub={textContent:'',style:{}}; const calls=[];
 const context={playerGeneration:4,playerPath:'/tv/123542/1/1',playerSource:2,document:{getElementById:id=>id==='tros-frame'?frame:sub},changePlayerSource:i=>calls.push(i)};
 vm.createContext(context);vm.runInContext(code+';failedPlayerSource(4)',context);
 assert.equal(frame.src,'about:blank');assert.equal(frame.style.visibility,'hidden');assert.match(sub.textContent,/källan/i);assert.equal(calls.length,0);
 context.playerSource=0;vm.runInContext('failedPlayerSource(5)',context);assert.deepEqual(calls,[]);
 vm.runInContext('failedPlayerSource(4)',context);assert.deepEqual(calls,[]);
});



