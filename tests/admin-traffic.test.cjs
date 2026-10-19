const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function dashboard(traffic) {
 const elements=new Map();
 function element() {return {
  textContent:'',value:'',hidden:false,children:[],handlers:{},attributes:{},
  addEventListener(name,callback){this.handlers[name]=callback;},
  setAttribute(name,value){this.attributes[name]=value;},
  replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);}
 };}
 const html=fs.readFileSync(require.resolve('../admin.html'),'utf8');
 const buttons=[...html.matchAll(/<button data-period="([^"]+)" aria-pressed="([^"]+)"/g)].map(match=>{
  const button=element();button.dataset={period:match[1]};button.attributes['aria-pressed']=match[2];return button;
 });
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 get('password').value='test-only-password';
 vm.runInNewContext(fs.readFileSync(require.resolve('../admin.js'),'utf8'),{
  document:{getElementById:get,querySelectorAll:()=>buttons,createElement:element,addEventListener(){}},
  window:{addEventListener(){}},URL,TextEncoder,AbortSignal,btoa,setInterval:()=>1,clearInterval(){},
  fetch:async url=>({ok:true,json:async()=>url.includes('/reports')?{reports:[]}:{traffic,services:{},uptimeSeconds:0,checkedAt:0,presence:{source:'redis'}}})
 });
 return {get,buttons,login:()=>get('login').handlers.submit({preventDefault(){}})};
}

test('admin switches from rolling periods to lifetime estimates and shows their collection start',async()=>{
 const period={visitors:3,pageViews:4,newBrowsers:1};
 const ui=dashboard({source:'redis',today:period,week:{...period,pageViews:30},month:period,allTime:{visitors:50,pageViews:120,newBrowsers:50,approximate:true,startedAt:1792411200000}});
 await ui.login();
 assert.equal(ui.get('traffic-cards').children[1].children[1].textContent,'4');
 ui.buttons.find(button=>button.dataset.period==='week').handlers.click();
 assert.equal(ui.get('traffic-cards').children[1].children[1].textContent,'30');
 const total=ui.buttons.find(button=>button.dataset.period==='allTime');assert.ok(total);
 total.handlers.click();
 assert.equal(total.attributes['aria-pressed'],'true');
 assert.equal(ui.buttons[0].attributes['aria-pressed'],'false');
 assert.equal(ui.get('traffic-cards').children[0].children[0].textContent,'Unika webbläsare');
 assert.equal(ui.get('traffic-cards').children[1].children[1].textContent,'≈ 120');
 assert.match(ui.get('traffic-note').textContent,/2026-10-19/);
 assert.match(ui.get('traffic-note').textContent,/uppskattningar/);
});

test('admin shows unknown lifetime during database failure and no fake 1970 start before collection',async()=>{
 for(const traffic of [{source:'unavailable',allTime:null},{source:'redis',allTime:{visitors:0,pageViews:0,newBrowsers:0,approximate:true,startedAt:null}}]) {
  const ui=dashboard(traffic);await ui.login();ui.buttons.find(button=>button.dataset.period==='allTime').handlers.click();
  assert.equal(ui.get('traffic-cards').children[0].children[1].textContent,traffic.source==='redis'?'≈ 0':'—');
  assert.ok(!ui.get('traffic-note').textContent.includes('1970'));
  assert.match(ui.get('traffic-note').textContent,traffic.source==='redis'?/första besöket/:/inte tillgänglig/);
 }
});
