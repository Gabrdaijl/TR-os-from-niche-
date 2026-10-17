const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function client(gpu){const context={window:{},navigator:{gpu}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../local-ai.js'),'utf8'),context);return context.window.TR_OS_LOCAL_AI;}
test('local AI reports unsupported WebGPU without sending prompts to a server',async()=>{
 await assert.rejects(client().complete([{role:'user',content:'hello'}],()=>{}),/WebGPU/);
});
test('local text AI rejects image messages before loading a model',async()=>{
 await assert.rejects(client({}).complete([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,test'}}]}],()=>{}),/text, inte bilder/);
});
