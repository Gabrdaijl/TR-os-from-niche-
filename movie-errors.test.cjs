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

test('Watch Now opens the player immediately while its protected connection starts', async () => {
 const source=fs.readFileSync(require.resolve('../nm.js'),'utf8');
 const start=source.indexOf('  async function launchFullscreen(');
 const end=source.indexOf('\n  function closeFullscreen(',start);
 assert.ok(start>=0&&end>start);
 const events=[];let finishSource;
 const elements={
  'tros-player-title':{textContent:''},'tros-player-sub':{textContent:''},
  'tros-player-status':{textContent:'',style:{}},
  'tros-player':{classList:{add(value){events.push('open:'+value);},contains(){return true;}}}
 };
 const context={URL,playerPath:'',document:{body:{style:{}},getElementById:id=>elements[id]},
  notifyMobilePlayer:value=>events.push('mobile:'+value),closeModal:()=>events.push('close-modal'),
  changePlayerSource:()=>{events.push('start-source');return new Promise(resolve=>{finishSource=resolve;});}};
 vm.createContext(context);
 const pending=vm.runInContext(source.slice(start,end)+';launchFullscreen("https://vidfast.vc/movie/42","Fixture","Fixture source")',context);
 assert.deepEqual(events,['open:open','mobile:true','close-modal','start-source']);
 assert.equal(context.document.body.style.overflow,'hidden');
 assert.equal(elements['tros-player-status'].style.display,'flex');
 assert.match(elements['tros-player-status'].textContent,/Startar filmanslutningen/);
 finishSource();await pending;
});



