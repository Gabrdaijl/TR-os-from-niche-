const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('Gimkit tools load the actual public integration without waiting for proxy startup',()=>{
 const elements={};
 for(const id of ['cheats-frame','status','platform-info','open-platform']) elements[id]={hidden:true,addEventListener(event,fn){this[event]=fn;}};
 const buttons=['gimkit','kahoot','blooket'].map(platform=>({dataset:{platform},addEventListener(event,fn){this[event]=fn;}}));
 const context={document:{getElementById:id=>elements[id],querySelectorAll:()=>buttons},$scramjetLoadController(){throw Error('Proxy must not be required for the direct integration');},console};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../cheats.js'),'utf8'),context);
 assert.equal(elements['cheats-frame'].src,'https://t9os.space/join');
 assert.match(elements['platform-info'].textContent,/extern tjänst/);
 assert.equal(elements['status'].hidden,true,'optional remote assets must not keep the usable tools hidden');
 assert.equal(elements['cheats-frame'].hidden,false);
 elements['cheats-frame'].load();
 assert.equal(elements['status'].hidden,true);
 assert.equal(elements['cheats-frame'].hidden,false);
 assert.equal(buttons.length,3);
});
