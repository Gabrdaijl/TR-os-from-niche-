(() => {
  const $ = id => document.getElementById(id);
  let authorization = '', timer, expires = 0, pending = false;
  const imageUrls = new Set();
  let traffic, period = 'today';
  let reportIds = null, banIds = null, conversationData = [], selectedConversation = '', conversationSignature = '', healthDown = null;
  function notifyAdmin(title, body) {
    $('notice').textContent = title + ' · ' + body;
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'tr-os-admin-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-') }); } catch {}
    }
  }
  function reportHealth(ok, detail = '') {
    if (healthDown === null) { healthDown = !ok; return; }
    if (!ok && !healthDown) notifyAdmin('Webbplatsen verkar vara nere', detail || 'Adminpanelen får inget svar från servern.');
    if (ok && healthDown) notifyAdmin('Webbplatsen svarar igen', 'Servern är tillgänglig.');
    healthDown = !ok;
  }
  const format = value => typeof value === 'number' ? value.toLocaleString('sv-SE') : '—';
  function renderTraffic() {
    const values = traffic?.[period];
    const allTime = period === 'allTime';
    $('traffic-cards').replaceChildren(...[[allTime?'Unika webbläsare':'Aktiva webbläsare',values?.visitors],['Sidvisningar',values?.pageViews],[allTime?'Nya webbläsare totalt':'Nya webbläsare',values?.newBrowsers]].map(([label,value])=>{
      const card=document.createElement('article');card.className='card';
      const heading=document.createElement('h3');heading.textContent=label;
      const number=document.createElement('div');number.className='big-number';number.textContent=(values?.approximate && typeof value==='number'?'≈ ':'')+format(value);
      card.append(heading,number);return card;
    }));
    let note='Uppdateras automatiskt';
    if(allTime && values) {
      const since=values.startedAt?new Date(values.startedAt).toLocaleString('sv-SE',{timeZone:'Europe/Stockholm'}):null;
      note=since?'Sedan '+since+' · uppskattning.':'Totalmätningen börjar vid första besöket.';
      note+=' Totalt visas som uppskattningar; äldre historik kan inte återskapas.';
    }
    $('traffic-note').textContent=traffic?.source==='redis' && values?note:'Statistik är inte tillgänglig. Kontrollera Redis-anslutningen.';
  }
  document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{
    period=button.dataset.period;
    document.querySelectorAll('[data-period]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    renderTraffic();
  }));
  $('admin-fullscreen').addEventListener('click',async()=>{
    try { if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen(); }
    catch { $('message').textContent='Fullskärm kunde inte startas. Prova F11.'; }
  });
  document.addEventListener('fullscreenchange',()=>{$('admin-fullscreen').textContent=document.fullscreenElement?'Avsluta fullskärm':'Fullskärm';});
  let reportSignature = '', banSignature = '', authGeneration = 0;
  function clearImages() { for (const url of imageUrls) URL.revokeObjectURL(url); imageUrls.clear(); }
  function logout() {
    authGeneration++;pending=false;clearImages();reportSignature='';banSignature='';reportIds=null;banIds=null;conversationData=[];selectedConversation='';conversationSignature='';healthDown=null;$('notice').textContent='';$('reports-list').replaceChildren();$('reports-state').textContent='';$('bans-list').replaceChildren();$('bans-state').textContent='';$('conversations-list').replaceChildren();$('conversation-messages').replaceChildren();$('conversation-form').hidden=true;$('conversation-state').textContent='';
    authorization = ''; clearInterval(timer); $('password').value = '';
    $('dashboard').hidden = true; $('cards').replaceChildren(); $('services').replaceChildren();
    $('login').hidden = false; $('logout').hidden = true;
  }
  async function refreshReports() {
    const generation=authGeneration;
    try {
      const response=await fetch('/api/admin/reports',{headers:{authorization},cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(generation!==authGeneration || !authorization)return;
      if(!response.ok)throw Error(data.error || 'Rapporterna kunde inte hämtas.');
      $('reports-state').textContent=data.reports.length?'':'Inga felrapporter ännu.';
      const currentIds=new Set(data.reports.map(report=>report.id));
      if(reportIds)for(const id of currentIds)if(!reportIds.has(id))notifyAdmin('Ny felrapport', 'En besökare har rapporterat ett fel.');
      reportIds=currentIds;
      const signature=JSON.stringify(data.reports);if(signature===reportSignature)return;reportSignature=signature;clearImages();
      const labels={home:'Startsidan',games:'Games',movies:'Movies',ai:'AI',browser:'Webbläsaren',snapchat:'Snapchat',cloud:'Cloud',other:'Annat'};
      $('reports-list').replaceChildren(...data.reports.map(report=>{
        const card=document.createElement('article');card.className='report-card';
        const top=document.createElement('div');top.className='report-card-top';
        const title=document.createElement('strong');title.textContent=labels[report.category] || 'Annat';
        const time=document.createElement('time');time.dateTime=new Date(report.createdAt).toISOString();time.textContent=new Date(report.createdAt).toLocaleString('sv-SE');
        top.append(title,time);const message=document.createElement('p');message.className='report-text';message.textContent=report.message;card.append(top,message);
        if(report.hasImage){
          const button=document.createElement('button');button.textContent='Visa bifogad bild';
          button.onclick=async()=>{
            button.disabled=true;
            try{
              const imageResponse=await fetch('/api/admin/reports/'+encodeURIComponent(report.id)+'/image',{headers:{authorization},cache:'no-store',signal:AbortSignal.timeout(10000)});
              if(!imageResponse.ok)throw Error('Bilden kunde inte hämtas.');
              const blob=await imageResponse.blob();if(generation!==authGeneration || !authorization || !card.isConnected)return;
              const url=URL.createObjectURL(blob);imageUrls.add(url);
              const image=document.createElement('img');image.alt='Besökarens bifogade felbild';image.src=url;image.className='report-image';button.replaceWith(image);
            }catch(error){if(generation===authGeneration){button.textContent=error.message;button.disabled=false;}}
          };card.append(button);
        }
        const seen=document.createElement('button');seen.type='button';seen.className='report-seen';seen.textContent='Jag såg den';
        seen.addEventListener('click',async()=>{
          seen.disabled=true;seen.textContent='Arkiverar…';
          try{
            const archived=await fetch('/api/admin/reports/'+encodeURIComponent(report.id)+'/seen',{method:'POST',headers:{authorization},cache:'no-store',signal:AbortSignal.timeout(10000)});
            const result=await archived.json();if(!archived.ok)throw Error(result.error||'Rapporten kunde inte arkiveras.');
            reportSignature='';await refreshReports();
          }catch(error){if(generation===authGeneration){seen.disabled=false;seen.textContent=error.message;}}
        });card.append(seen);
        return card;
      }));
    }catch(error){if(generation===authGeneration && authorization)$('reports-state').textContent=error.message;}
  }
  async function refreshBans() {
    const generation = authGeneration;
    try {
      const response = await fetch('/api/admin/moderation/bans', { headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (generation !== authGeneration || !authorization) return;
      if (!response.ok) throw Error(data.error || 'Spärrlistan kunde inte hämtas.');
      const bans = Array.isArray(data.bans) ? data.bans : [];
      $('ban-count').textContent = format(bans.length);
      $('bans-state').textContent = data.source === 'redis'
        ? 'Spärrarna sparas.'
        : 'Tillfällig lagring. Spärrar kan försvinna vid omstart.';
      const signature = JSON.stringify({ source: data.source, bans });
      const currentIds=new Set(bans.map(ban=>ban.id));
      if(banIds)for(const id of currentIds)if(!banIds.has(id))notifyAdmin('Ny spärr', 'En webbläsare har blockerats automatiskt.');
      banIds=currentIds;
      if (signature === banSignature) return;
      banSignature = signature;
      if (!bans.length) {
        const empty = document.createElement('div'); empty.className = 'ban-empty'; empty.textContent = 'Inga aktiva spärrar.';
        $('bans-list').replaceChildren(empty);
        return;
      }
      $('bans-list').replaceChildren(...bans.map(ban => {
        const card = document.createElement('article'); card.className = 'ban-card';
        const details = document.createElement('div'); details.className = 'ban-details';
        const identity = document.createElement('strong'); identity.className = 'ban-id'; identity.textContent = 'Webbläsare ' + ban.id.slice(0, 12) + '…'; identity.title = ban.id;
        const time = document.createElement('time'); time.dateTime = new Date(ban.createdAt).toISOString(); time.textContent = 'Spärrad ' + new Date(ban.createdAt).toLocaleString('sv-SE');
        const reason = document.createElement('span'); reason.textContent = 'Sökning efter vuxeninnehåll';
        details.append(identity, time, reason);
        const remove = document.createElement('button'); remove.className = 'ban-remove'; remove.type = 'button'; remove.textContent = 'Häv spärr';
        remove.addEventListener('click', async () => {
          remove.disabled = true; remove.textContent = 'Häver…';
          try {
            const result = await fetch('/api/admin/moderation/bans/' + encodeURIComponent(ban.id), { method: 'DELETE', headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
            const body = await result.json();
            if (!result.ok) throw Error(body.error || 'Spärren kunde inte hävas.');
            banSignature = '';
            await refreshBans();
          } catch (error) {
            if (generation === authGeneration) { $('bans-state').textContent = error.message; remove.disabled = false; remove.textContent = 'Försök igen'; }
          }
        });
        card.append(details, remove); return card;
      }));
    } catch (error) {
      if (generation === authGeneration && authorization) $('bans-state').textContent = error.message;
    }
  }
  function renderConversations() {
    const list=$('conversations-list');
    if(!conversationData.length){
      const empty=document.createElement('p');empty.className='conversation-empty';empty.textContent='Inga supportmeddelanden ännu.';list.replaceChildren(empty);
      $('conversation-messages').replaceChildren();$('conversation-form').hidden=true;$('conversation-state').textContent='Inga meddelanden ännu.';return;
    }
    list.replaceChildren(...conversationData.map(item=>{
      const button=document.createElement('button');button.type='button';button.className='conversation-choice'+(item.id===selectedConversation?' selected':'');
      const title=document.createElement('strong');title.textContent='Webbläsare '+item.id.slice(0,12)+'…';
      const last=item.messages?.at(-1);const preview=document.createElement('span');preview.textContent=last?.text||'Inget meddelande';
      const time=document.createElement('time');if(last?.createdAt){time.dateTime=last.createdAt;time.textContent=new Date(last.createdAt).toLocaleString('sv-SE');}
      button.append(title,preview,time);button.addEventListener('click',()=>{selectedConversation=item.id;conversationSignature='';renderConversations();renderConversation();});return button;
    }));
    renderConversation();
  }
  function renderConversation() {
    const item=conversationData.find(entry=>entry.id===selectedConversation)||conversationData[0];
    if(!item){$('conversation-messages').replaceChildren();$('conversation-form').hidden=true;return;}
    selectedConversation=item.id;$('conversation-form').hidden=false;
    const messages=Array.isArray(item.messages)?item.messages:[];
    const signature=JSON.stringify({id:item.id,messages});if(signature===conversationSignature)return;conversationSignature=signature;
    $('conversation-messages').replaceChildren(...messages.map(message=>{
      const card=document.createElement('article');card.className='conversation-message'+(message.role==='admin'?' from-admin':'');
      const heading=document.createElement('strong');heading.textContent=message.role==='admin'?'Admin':'Spärrad webbläsare';
      const text=document.createElement('p');text.textContent=message.text;
      const time=document.createElement('time');time.textContent=new Date(message.createdAt).toLocaleString('sv-SE');
      card.append(heading,text,time);return card;
    }));
    $('conversation-messages').scrollTop=$('conversation-messages').scrollHeight;
    $('conversation-state').textContent='Webbläsare '+item.id.slice(0,12)+'…';
  }
  async function refreshConversations() {
    const generation=authGeneration;
    try{
      const response=await fetch('/api/admin/moderation/conversations',{headers:{authorization},cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(generation!==authGeneration||!authorization)return;
      if(!response.ok)throw Error(data.error||'Supportmeddelanden kunde inte hämtas.');
      const entries=Array.isArray(data.conversations)?data.conversations:[];
      if(conversationData.length){
        const previous=new Map(conversationData.map(item=>[item.id,item.messages?.at(-1)?.id]));
        for(const item of entries){const latest=item.messages?.at(-1)?.id;if(latest&&previous.has(item.id)&&previous.get(item.id)!==latest&&item.messages?.at(-1)?.role==='browser')notifyAdmin('Nytt supportmeddelande','En spärrad webbläsare har skrivit till dig.');}
      }
      conversationData=entries;$('conversation-count').textContent=format(entries.length);
      if(!entries.some(item=>item.id===selectedConversation))selectedConversation=entries[0]?.id||'';
      renderConversations();
    }catch(error){if(generation===authGeneration&&authorization)$('conversation-state').textContent=error.message;}
  }
  $('conversation-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!selectedConversation)return;
    const input=$('conversation-input'),button=$('conversation-form').querySelector('button'),text=input.value.trim();if(!text)return;
    button.disabled=true;$('conversation-state').textContent='Skickar…';
    try{
      const response=await fetch('/api/admin/moderation/conversations/'+encodeURIComponent(selectedConversation)+'/messages',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({text}),cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Svaret kunde inte skickas.');input.value='';await refreshConversations();$('conversation-state').textContent='Svaret skickades.';
    }catch(error){$('conversation-state').textContent=error.message;}
    finally{button.disabled=false;}
  });
  async function refresh() {
    if (pending) return;
    if (!authorization || Date.now() >= expires) return logout();
    pending = true;
    const generation=authGeneration;
    let healthCheckFailed=true;
    try {
      const response = await fetch('/api/admin/status', { headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      healthCheckFailed=response.status>=500;
      const data = await response.json();
      if(generation!==authGeneration || !authorization)return;
      if (!response.ok) { if(response.status===401 || response.status===403)logout(); throw Error(data.error || 'Status kunde inte hämtas'); }
      reportHealth(true);
      $('message').textContent = '';
      traffic=data.traffic;renderTraffic();
      $('login').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
      $('active-count').textContent = typeof data.activeSessions === 'number' ? data.activeSessions : '—';
      $('recent-count').textContent = typeof data.recentVisitors === 'number' ? data.recentVisitors : '—';
      const connected = data.presence?.source === 'redis';
      $('traffic-state').textContent = connected ? '● LIVE' : 'VÄNTAR';
      $('db-state').textContent = connected ? '● Live · Redis' : 'Databasen inte tillgänglig';
      $('db-state').className = connected ? 'state' : 'state warning';
      const metrics = [['WebSocket-anslutningar', data.websocketConnections], ['Drifttid', Math.floor(data.uptimeSeconds / 60) + ' min'], ['Anrop', data.requests], ['Serverfel (5xx)', data.serverErrors], ['Minne', data.memoryMB + ' MB']];
      $('cards').replaceChildren(...metrics.map(([label, value]) => {
        const card = document.createElement('div'); card.className = 'card';
        const title = document.createElement('h2'); title.textContent = label;
        const number = document.createElement('div'); number.className = 'number'; number.textContent = String(value);
        card.append(title, number); return card;
      }));
      const labels = { server: 'Server', database: 'Databas', proxy: 'Webbproxy', ai: 'AI-chatt', vpn: 'VPN-tunnel', movies: 'Filmer', cloud: 'Cloud gaming', chat: 'Chatt & närvaro' };
      $('services').replaceChildren(...Object.entries(data.services).map(([name, status]) => {
        const card = document.createElement('article'); card.className = 'service';
        const top = document.createElement('div'); top.className = 'service-top';
        const title = document.createElement('h3'); title.textContent = labels[name] || name;
        const pill = document.createElement('span'); pill.className = 'pill'; pill.textContent = 'Info';
        if (name === 'database') { pill.textContent = connected ? 'Ansluten' : 'Saknas'; pill.classList.add(connected ? 'ok' : 'warn'); }
        if (name === 'server') { pill.textContent = 'Tillgänglig'; pill.classList.add('ok'); }
        const description = document.createElement('p'); description.textContent = status;
        top.append(title, pill); card.append(top, description); return card;
      }));
      $('scope').textContent = data.scope;
      $('updated').textContent = 'Senast kontrollerad ' + new Date(data.checkedAt).toLocaleTimeString('sv-SE') + ' · uppdateras var 15:e sekund';
      await refreshBans();
      await refreshReports();
      await refreshConversations();
    } catch (error) { if(healthCheckFailed&&authorization)reportHealth(false,error.message);$('message').textContent = error.message; }
    finally { if(generation===authGeneration)pending = false; }
  }
  $('login').addEventListener('submit', async event => {
    event.preventDefault();
    const bytes = new TextEncoder().encode('admin:' + $('password').value);
    authorization = 'Basic ' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    $('password').value = ''; expires = Date.now() + 30 * 60000;
    clearInterval(timer); await refresh(); if (authorization && $('login').hidden) timer = setInterval(refresh, 15000);
  });
  $('logout').addEventListener('click', logout);
  $('refresh').addEventListener('click', refresh);
  $('notifications').addEventListener('click',async()=>{
    if(!('Notification' in window)){ $('notice').textContent='Den här webbläsaren stöder inte notiser.';return; }
    try{
      const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      $('notifications').textContent=permission==='granted'?'Notiser aktiverade':permission==='denied'?'Notiser blockerade':'Aktivera notiser';
      $('notice').textContent=permission==='granted'?'Webbläsarnotiser är aktiverade. Adminpanelen visar också nya händelser här.':'Tillåt notiser i webbläsarens webbplatsinställningar för att få notiser.';
    }catch{$('notice').textContent='Notiser kunde inte aktiveras i den här webbläsaren.';}
  });
  window.addEventListener('pagehide', logout);
})();
