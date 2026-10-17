const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
test('launcher keeps the complete 441-entry catalog and separate cloud providers',()=>{
 const context={window:{}};
 const script=fs.readFileSync(path.join(__dirname,'../launcher-catalog.js'),'utf8');
 vm.runInNewContext(script,context,{timeout:1000});
 const games=context.window.TR_OS_LAUNCHER_GAMES;
 assert.equal(games.length,441);
 assert.equal(new Set(games.map(g=>g.key)).size,441);
 assert.equal(games.filter(g=>g.provider==='cloud').length,225);
 assert.equal(games.filter(g=>g.provider==='mobile').length,216);
 for(const game of games){assert.ok(game.name);assert.ok(game.img);assert.ok(game.provider);}
 assert.ok(games.find(g=>g.name==='Roblox'&&g.provider==='mobile'&&g.packageName==='com.roblox.client'));
 for(const game of games.filter(g=>g.provider==='mobile')) {
  const url=new URL(game.playerUrl);
  assert.equal(url.origin,'https://web.cloudmoonapp.com');
  assert.equal(url.pathname,'/game/'+encodeURIComponent(game.packageName)+'/');
  assert.ok(game.packageName);
 }
 assert.ok(games.filter(g=>g.provider==='cloud').every(g=>!g.playerUrl));
 assert.ok(games.find(g=>g.name==='Grand Theft Auto V'&&g.provider==='cloud'));
 assert.ok(games.filter(g=>g.provider==='mobile').every(g=>/^data:image\/(png|jpeg|webp);base64,/.test(g.img)));
 assert.ok(!/guestsynapse|Password!|sk_live_name_here|t9os|niche/i.test(script));
});
