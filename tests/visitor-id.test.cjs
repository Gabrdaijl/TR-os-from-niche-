const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
function browser(storage,locks){
 const window={fetch:async()=>{throw Error('No network expected');},TR_OS_CONFIG:{}};window.parent=window;window.top=window;
 const context={window,URL,crypto,localStorage:storage,navigator:{locks},location:{origin:'https://tr-os.test'},document:{currentScript:{src:'https://tr-os.test/tr-os.runtime.js'},readyState:'loading',addEventListener(){}},setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../tr-os.runtime.js'),'utf8'),context);return window.TR_OS;
}
test('tabs and reloads share one stable visitor ID without network requests',async()=>{
 const values=new Map();let queue=Promise.resolve();const locks={request(_name,fn){const next=queue.then(fn);queue=next.catch(()=>{});return next;}};
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const a=browser(storage,locks),b=browser(storage,locks);const [one,two]=await Promise.all([a.visitorId(),b.visitorId()]);assert.equal(one,two);assert.equal(await browser(storage,locks).visitorId(),one);
});
test('blocked local storage still preserves the ID during one page session',async()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};const a=browser(storage);assert.equal(await a.visitorId(),await a.visitorId());
});
