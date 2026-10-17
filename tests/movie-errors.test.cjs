const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('last failed movie source stops and offers a retry instead of showing provider errors',()=>{
 const source=fs.readFileSync(require.resolve('../nm.js'),'utf8');
 const code=source.slice(source.indexOf('  function failedPlayerSource('),source.indexOf('  async function changePlayerSource('));
 const frame={style:{},src:'failed'}; const sub={textContent:'',style:{}}; const calls=[];
 const context={playerGeneration:4,playerPath:'/tv/123542/1/1',playerSource:2,document:{getElementById:id=>id==='tros-frame'?frame:sub},changePlayerSource:i=>calls.push(i)};
 vm.createContext(context);vm.runInContext(code+';failedPlayerSource(4)',context);
 assert.equal(frame.src,'about:blank');assert.equal(frame.style.visibility,'hidden');assert.match(sub.textContent,/Ingen källa/);assert.equal(calls.length,0);
 context.playerSource=0;vm.runInContext('failedPlayerSource(5)',context);assert.deepEqual(calls,[1]);
 vm.runInContext('failedPlayerSource(4)',context);assert.deepEqual(calls,[1]);
});

