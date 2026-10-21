(() => {
  const $ = id => document.getElementById(id);
  let authorization = '', timer, expires = 0, pending = false, pushReady = false, pushRegistration = null;
  const imageUrls = new Set();
  let traffic, period = 'today', databaseConnected = null;
  let reportIds = null, banIds = null, conversationData = [], conversationsLoaded = false, selectedConversation = '', conversationSignature = '', healthDown = null;
  let memberUsers = [], memberPayments = [], memberPlans = [], reportedPaymentIds = null, knownMemberIds = null;
  let memberSearch = '', priorityReports = [], priorityBans = [];
  const priorityStatus = { members: 'loading', reports: 'loading', bans: 'loading', support: 'loading' };
  function notifyAdmin(title, body) {
    const notice=$('notice');
    const lower=title.toLocaleLowerCase('sv-SE');
    let kind='update',symbol='•',href='#overview',actionText='Visa';
    if(lower.includes('swish')){kind='critical';symbol='!';href='#payments-list';actionText='Godkänn';}
    else if(lower.includes('kundkonto')){kind='important';symbol='+';href='#members';actionText='Öppna kund';}
    else if(lower.includes('support')){kind='urgent';symbol='↗';href='#support';actionText='Öppna chatten';}
    else if(lower.includes('felrapport')){kind='urgent';symbol='!';href='#reports';actionText='Granska';}
    else if(lower.includes('spärr')){kind='warning';symbol='!';href='#bans';actionText='Granska';}
    else if(lower.includes('verkar vara nere')){kind='critical';symbol='!';href='#system';actionText='Systemstatus';}
    else if(lower.includes('svarar igen')){kind='success';symbol='✓';href='#system';actionText='Systemstatus';}
    const item=document.createElement('article');item.className='notice-item notice-'+kind;
    const icon=document.createElement('span');icon.className='notice-icon';icon.setAttribute('aria-hidden','true');icon.textContent=symbol;
    const copy=document.createElement('span');copy.className='notice-copy';
    const heading=document.createElement('strong');heading.textContent=title;
    const detail=document.createElement('span');detail.textContent=body;copy.append(heading,detail);
    const action=document.createElement('a');action.className='notice-action';action.href=href;action.textContent=actionText;
    if(href==='#system')action.addEventListener('click',()=>$('system').open=true);
    const time=document.createElement('time');const now=new Date();time.dateTime=now.toISOString();time.textContent=now.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'});
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='notice-dismiss';dismiss.setAttribute('aria-label','Stäng notis');dismiss.textContent='×';
    dismiss.addEventListener('click',()=>{item.remove();if(!notice.children.length)notice.classList.remove('has-notice');});
    item.dataset.priority=String(({critical:0,urgent:1,important:2,warning:3,update:4,success:5})[kind]);item.dataset.when=String(now.getTime());
    item.append(icon,copy,action,time,dismiss);
    const items=[...notice.children,item].sort((a,b)=>Number(a.dataset.priority)-Number(b.dataset.priority)||Number(b.dataset.when)-Number(a.dataset.when));
    notice.classList.add('has-notice');notice.replaceChildren(...items.slice(0,4));
    if (!pushReady && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon:'/logo.png', tag: 'tr-os-admin-' + lower.replace(/[^a-z0-9]+/g, '-') }); } catch {}
    }
  }
  function setNoticeMessage(message) {
    const notice=$('notice');notice.classList.remove('has-notice');notice.textContent=message;
  }
  function applicationServerKey(value) {
    const base64=value.replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(base64+'='.repeat((4-base64.length%4)%4)),character=>character.charCodeAt(0));
  }
  async function saveAdminSubscription(subscription) {
    const response=await fetch('/api/admin/push/subscription',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON()}),cache:'no-store',signal:AbortSignal.timeout(10000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Pushprenumerationen kunde inte sparas.');
    pushReady=true;pushRegistration=await navigator.serviceWorker.getRegistration('/push/');
    $('notifications').textContent='Push aktivt på denna enhet';
    setNoticeMessage('Enheten får notiser även när TR-os är stängt. Aktivera push på varje enhet du vill nå.');
  }
  async function syncAdminSubscription() {
    if(!authorization||!('Notification' in window)||Notification.permission!=='granted'||!('serviceWorker' in navigator))return;
    try{
      const registration=await navigator.serviceWorker.getRegistration('/push/');
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription)await saveAdminSubscription(subscription);
    }catch{}
  }
  function reportHealth(ok, detail = '') {
    if (healthDown === null) { healthDown = !ok; return; }
    if (!ok && !healthDown) notifyAdmin('Webbplatsen verkar vara nere', detail || 'Adminpanelen får inget svar från servern.');
    if (ok && healthDown) notifyAdmin('Webbplatsen svarar igen', 'Servern är tillgänglig.');
    healthDown = !ok;
  }
  const format = value => typeof value === 'number' ? value.toLocaleString('sv-SE') : '—';
  function renderPriorityQueue() {
    if(Object.values(priorityStatus).some(status=>status==='loading')||!authorization)return;
    const panel=$('priority-panel'),list=$('priority-list'),items=[];
    if(databaseConnected===false)items.push({label:'Databasen är inte ansluten',detail:'Närvaro och sparad information kan vara begränsad.',count:1,href:'#system',kind:'critical'});
    if(Object.values(priorityStatus).some(status=>status==='error'))items.push({label:'Några ärenden kunde inte hämtas',detail:'Tryck på Uppdatera för att försöka igen.',count:1,href:'#overview',kind:'critical'});
    const approvals=memberPayments.filter(payment=>payment.status==='pending'&&payment.paidRequested).length;
    if(approvals)items.push({label:'Swishbetalningar att godkänna',detail:'Kontrollera betalningen innan åtkomst läggs till.',count:approvals,href:'#payments-list',kind:'critical'});
    const withoutAccess=memberUsers.filter(user=>user.enabled&&!user.active).length;
    if(withoutAccess)items.push({label:'Kunder utan aktiv åtkomst',detail:'Konton som kan behöva få eller förlänga sin tid.',count:withoutAccess,href:'#members',kind:'important'});
    const soon=memberUsers.filter(user=>user.enabled&&user.active&&Number(user.accessUntilMs)>Date.now()&&Number(user.accessUntilMs)<=Date.now()+3*24*60*60*1000).length;
    if(soon)items.push({label:'Åtkomst går ut inom tre dagar',detail:'Se vilka kunder som snart behöver mer tid.',count:soon,href:'#members',kind:'warning'});
    const unread=conversationData.filter(item=>item.messages?.at(-1)?.role==='browser').length;
    if(unread)items.push({label:'Nya supportmeddelanden',detail:'Besökare väntar på svar i supportchatten.',count:unread,href:'#support',kind:'urgent'});
    if(priorityReports.length)items.push({label:'Felrapporter att granska',detail:'Öppna rapporten och arkivera den när du är klar.',count:priorityReports.length,href:'#reports',kind:'urgent'});
    if(priorityBans.length)items.push({label:'Aktiva spärrar',detail:'Granska blockerade webbläsare och häv spärrar vid behov.',count:priorityBans.length,href:'#bans',kind:'warning'});
    const total=items.reduce((sum,item)=>sum+item.count,0);
    $('priority-count').textContent=format(total);
    $('priority-count').classList.toggle('is-clear',total===0);
    if(!items.length){
      const empty=document.createElement('div');empty.className='priority-clear';
      const mark=document.createElement('span');mark.className='priority-clear-mark';mark.setAttribute('aria-hidden','true');mark.textContent='✓';
      const copy=document.createElement('span');copy.textContent='Allt är uppdaterat. Nya betalningar, konton och meddelanden visas här först.';
      empty.append(mark,copy);list.replaceChildren(empty);
    }else{
      list.replaceChildren(...items.map(item=>{
        const link=document.createElement('a');link.className='priority-item priority-'+item.kind;link.href=item.href;
        if(item.href==='#system')link.addEventListener('click',()=>$('system').open=true);
        const marker=document.createElement('span');marker.className='priority-marker';marker.setAttribute('aria-hidden','true');marker.textContent='•';
        const copy=document.createElement('span');copy.className='priority-copy';
        const title=document.createElement('strong');title.textContent=item.label;
        const detail=document.createElement('span');detail.textContent=item.detail;copy.append(title,detail);
        const count=document.createElement('span');count.className='priority-item-count';count.textContent=format(item.count);count.setAttribute('aria-label',item.count+' ärenden');
        const arrow=document.createElement('span');arrow.className='priority-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='→';
        link.append(marker,copy,count,arrow);return link;
      }));
    }
    panel.hidden=false;
  }
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
  function clearAdminView() {
    authGeneration++;pending=false;pushReady=false;pushRegistration=null;clearImages();reportSignature='';banSignature='';reportIds=null;banIds=null;conversationData=[];conversationsLoaded=false;priorityReports=[];priorityBans=[];priorityStatus.members='loading';priorityStatus.reports='loading';priorityStatus.bans='loading';priorityStatus.support='loading';databaseConnected=null;selectedConversation='';conversationSignature='';healthDown=null;setNoticeMessage('');$('priority-panel').hidden=true;$('reports-list').replaceChildren();$('reports-state').textContent='';$('bans-list').replaceChildren();$('bans-state').textContent='';$('conversations-list').replaceChildren();$('conversation-messages').replaceChildren();$('conversation-form').hidden=true;$('conversation-state').textContent='';
    authorization = ''; clearInterval(timer); $('password').value = ''; $('message').textContent = '';
    expires = 0; $('dashboard').hidden = true; $('cards').replaceChildren(); $('services').replaceChildren();
    $('login').hidden = false; $('logout').hidden = true;
  }
  async function logoutAdmin() {
    try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) }); } catch {}
    clearAdminView();
  }
  async function refreshReports() {
    const generation=authGeneration;
    try {
      const response=await fetch('/api/admin/reports',{headers:{authorization},cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();
      if(generation!==authGeneration || !authorization)return;
      if(!response.ok)throw Error(data.error || 'Rapporterna kunde inte hämtas.');
      priorityReports=Array.isArray(data.reports)?data.reports:[];priorityStatus.reports='ready';renderPriorityQueue();
      $('reports-state').textContent=priorityReports.length?'':'Inga felrapporter ännu.';
      const currentIds=new Set(priorityReports.map(report=>report.id));
      if(reportIds)for(const id of currentIds)if(!reportIds.has(id))notifyAdmin('Ny felrapport', 'En besökare har rapporterat ett fel.');
      reportIds=currentIds;
      const signature=JSON.stringify(priorityReports);if(signature===reportSignature)return;reportSignature=signature;clearImages();
      const labels={home:'Startsidan',games:'Games',movies:'Movies',ai:'AI',browser:'Webbläsaren',snapchat:'Snapchat',cloud:'Cloud',other:'Annat'};
      $('reports-list').replaceChildren(...priorityReports.map(report=>{
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
    }catch(error){if(generation===authGeneration && authorization){priorityStatus.reports='error';renderPriorityQueue();$('reports-state').textContent=error.message;}}
  }
  async function refreshBans() {
    const generation = authGeneration;
    try {
      const response = await fetch('/api/admin/moderation/bans', { headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (generation !== authGeneration || !authorization) return;
      if (!response.ok) throw Error(data.error || 'Spärrlistan kunde inte hämtas.');
      const bans = Array.isArray(data.bans) ? data.bans : [];
      priorityBans=bans;priorityStatus.bans='ready';renderPriorityQueue();
      $('ban-count').textContent = format(bans.length);
      $('bans-state').textContent = data.source === 'redis'
        ? 'Spärrarna sparas.'
        : 'Tillfällig lagring. Spärrar kan försvinna vid omstart.';
      const signature = JSON.stringify({ source: data.source, bans });
      const currentIds=new Set(bans.map(ban=>ban.id));
      const previousIds=banIds;
      if(previousIds)for(const id of currentIds)if(!previousIds.has(id))notifyAdmin('Ny spärr', 'En webbläsare har blockerats automatiskt.');
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
            await refreshConversations();
          } catch (error) {
            if (generation === authGeneration) { $('bans-state').textContent = error.message; remove.disabled = false; remove.textContent = 'Försök igen'; }
          }
        });
        card.append(details, remove); return card;
      }));
    } catch (error) {
      if (generation === authGeneration && authorization) { priorityStatus.bans='error';renderPriorityQueue();$('bans-state').textContent = error.message; }
    }
  }
  function renderConversations() {
    const list=$('conversations-list');
    if(!conversationData.length){
      const empty=document.createElement('p');empty.className='conversation-empty';empty.textContent='Inga supportmeddelanden ännu.';list.replaceChildren(empty);
      $('conversation-messages').replaceChildren();$('conversation-form').hidden=true;$('conversation-delete').hidden=true;$('conversation-state').textContent='Inga meddelanden ännu.';return;
    }
    list.replaceChildren(...conversationData.map(item=>{
      const button=document.createElement('button');button.type='button';button.className='conversation-choice'+(item.id===selectedConversation?' selected':'');
      const title=document.createElement('strong');title.textContent='Webbläsare '+item.id.slice(0,12)+'…';
      const last=item.messages?.at(-1);const preview=document.createElement('span');preview.textContent=last?.text||'Inget meddelande';
      const time=document.createElement('time');if(last?.createdAt){time.dateTime=last.createdAt;time.textContent=new Date(last.createdAt).toLocaleString('sv-SE');}
      const badge=document.createElement('em');badge.className='conversation-badge'+(last?.role==='browser'?' unread':'');badge.textContent=last?.role==='browser'?'Nytt':banIds?.has(item.id)?'Spärrad':'Spärr hävd';
      const top=document.createElement('span');top.className='conversation-choice-top';top.append(title,badge);
      button.append(top,preview,time);button.addEventListener('click',()=>{selectedConversation=item.id;conversationSignature='';renderConversations();renderConversation();if(matchMedia('(max-width: 760px)').matches)$('conversation-panel').scrollIntoView({behavior:'smooth',block:'start'});});return button;
    }));
    renderConversation();
  }
  function renderConversation() {
    const item=conversationData.find(entry=>entry.id===selectedConversation)||conversationData[0];
    if(!item){$('conversation-messages').replaceChildren();$('conversation-form').hidden=true;$('conversation-delete').hidden=true;return;}
    selectedConversation=item.id;$('conversation-form').hidden=false;$('conversation-delete').hidden=false;
    const messages=Array.isArray(item.messages)?item.messages:[];
    const signature=JSON.stringify({id:item.id,messages});if(signature===conversationSignature)return;conversationSignature=signature;
    $('conversation-messages').replaceChildren(...messages.map(message=>{
      const card=document.createElement('article');card.className='conversation-message'+(message.role==='admin'?' from-admin':'');
      const heading=document.createElement('strong');heading.textContent=message.role==='admin'?'Du · Admin':'Webbläsare';
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
      if(conversationsLoaded){
        const previous=new Map(conversationData.map(item=>[item.id,item.messages?.at(-1)?.id]));
        for(const item of entries){const latest=item.messages?.at(-1)?.id;if(latest&&item.messages?.at(-1)?.role==='browser'&&(!previous.has(item.id)||previous.get(item.id)!==latest))notifyAdmin('Nytt supportmeddelande','En besökare väntar på svar i supportchatten.');}
      }
      entries.sort((a,b)=>{
        const unreadA=a.messages?.at(-1)?.role==='browser',unreadB=b.messages?.at(-1)?.role==='browser';
        if(unreadA!==unreadB)return unreadB-unreadA;
        const timeA=Date.parse(a.messages?.at(-1)?.createdAt||'')||Number(a.updatedAt)||0;
        const timeB=Date.parse(b.messages?.at(-1)?.createdAt||'')||Number(b.updatedAt)||0;
        return timeB-timeA;
      });
      conversationData=entries;conversationsLoaded=true;priorityStatus.support='ready';renderPriorityQueue();$('conversation-count').textContent=format(entries.filter(item=>item.messages?.at(-1)?.role==='browser').length);
      if(!entries.some(item=>item.id===selectedConversation))selectedConversation=entries[0]?.id||'';
      renderConversations();
    }catch(error){if(generation===authGeneration&&authorization){priorityStatus.support='error';renderPriorityQueue();$('conversation-state').textContent=error.message;}}
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
  $('conversation-delete').addEventListener('click',async()=>{
    if(!selectedConversation||!window.confirm('Ta bort den här supportchatten och alla dess meddelanden permanent?'))return;
    const id=selectedConversation,button=$('conversation-delete');button.disabled=true;button.textContent='Tar bort…';
    try{
      const response=await fetch('/api/admin/moderation/conversations/'+encodeURIComponent(id),{method:'DELETE',headers:{authorization},cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Chatten kunde inte tas bort.');if(!data.removed)throw Error('Chatten fanns inte kvar. Uppdatera supportlistan.');
      conversationData=conversationData.filter(item=>item.id!==id);selectedConversation='';conversationSignature='';await refreshConversations();$('conversation-state').textContent=conversationData.length?'Chatten raderades. Välj ett annat ärende.':'Chatten raderades.';
    }catch(error){$('conversation-state').textContent=error.message;}
    finally{button.disabled=false;button.textContent='Ta bort chatten';}
  });
  async function memberRequest(path,options={}){
    const response=await fetch(path,{cache:'no-store',...options,headers:{authorization,...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})},signal:AbortSignal.timeout(10000)});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Medlemsuppgifterna kunde inte sparas.');return data;
  }
  function memberField(label,type,value,name,extra={}){
    const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label));
    const input=document.createElement('input');input.type=type;input.name=name;if(value!==undefined&&value!==null)input.value=String(value);Object.assign(input,extra);wrapper.append(input);return wrapper;
  }
  function renderPayments(){
    const payments=memberPayments.slice().sort((a,b)=>{
      const waitingA=a.status==='pending'&&a.paidRequested,waitingB=b.status==='pending'&&b.paidRequested;
      if(waitingA!==waitingB)return waitingB-waitingA;
      const time=value=>Date.parse(value||'')||Number(value)||0;
      return time(b.customerReportedPaidAt||b.createdAt)-time(a.customerReportedPaidAt||a.createdAt);
    }).slice(0,100);
    $('payments-list').replaceChildren(...(payments.length?payments.map(payment=>{
      const card=document.createElement('article');card.className='member-card payment-card';
      const detail=document.createElement('div');detail.className='member-card-details';
      const name=document.createElement('strong');name.textContent=payment.firstName+' '+payment.lastName;
      const meta=document.createElement('span');meta.textContent=payment.email+' · '+payment.amount+' kr · '+payment.durationDays+' dagar';
      const status=document.createElement('span');
      status.textContent=payment.status==='paid'?'Betalning godkänd manuellt':payment.status==='pending'&&payment.paidRequested?'Anmäld · väntar på din kontroll':payment.status==='pending'?'Väntar på att medlemmen anmäler betalningen':'Betalning '+payment.status;
      const when=document.createElement('time');when.textContent=(payment.confirmedAt?'Godkänd ':payment.customerReportedPaidAt?'Anmäld ':'Skapad ')+new Date(payment.confirmedAt||payment.customerReportedPaidAt||payment.createdAt).toLocaleString('sv-SE');
      detail.append(name,meta,status,when);
      if(payment.reportedFirstName||payment.reportedLastName){const payer=document.createElement('span');payer.textContent='Anmält betalarens namn: '+[payment.reportedFirstName,payment.reportedLastName].filter(Boolean).join(' ');detail.append(payer);}
      const ref=document.createElement('code');ref.textContent='Meddelande i Swish: '+payment.reference;detail.append(ref);
      if(payment.status==='pending'&&payment.paidRequested){
        const confirm=document.createElement('button');confirm.type='button';confirm.className='confirm-payment';confirm.textContent='Bekräfta Swish';
        confirm.addEventListener('click',async()=>{
          confirm.disabled=true;confirm.textContent='Godkänner…';
          try{await memberRequest('/api/admin/payments/'+encodeURIComponent(payment.id)+'/confirm',{method:'POST',body:'{}'});await refreshMembership();$('members-state').textContent='Betalningen godkändes och '+payment.durationDays+' dagar lades till för '+payment.firstName+' '+payment.lastName+'.';}
          catch(error){$('members-state').textContent=error.message;confirm.disabled=false;confirm.textContent='Försök igen';}
        });
        card.append(detail,confirm);
      }else card.append(detail);
      return card;
    }):[Object.assign(document.createElement('p'),{className:'member-empty',textContent:'Inga Swishbetalningar ännu.'})]));
  }
  function renderMemberStats(){
    const active=memberUsers.filter(user=>user.active).length;
    const expired=memberUsers.filter(user=>user.enabled&& !user.active).length;
    const paused=memberUsers.filter(user=>!user.enabled).length;
    const waiting=memberPayments.filter(payment=>payment.status==='pending'&&payment.paidRequested).length;
    const stats=[['Konton',memberUsers.length],['Aktiva',active],['Utan aktiv tid',expired],['Pausade',paused],['Väntar på godkännande',waiting]];
    $('member-stats').replaceChildren(...stats.map(([label,value])=>{
      const card=document.createElement('div');card.className='member-stat';
      const number=document.createElement('strong');number.textContent=format(value);
      const caption=document.createElement('span');caption.textContent=label;card.append(number,caption);return card;
    }));
  }
  function renderMembers(){
    $('member-count').textContent=format(memberUsers.length);
    const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sv-SE');
    const query=normalize(memberSearch);
    const visibleUsers=(query?memberUsers.filter(user=>normalize(user.firstName+' '+user.lastName+' '+user.email).includes(query)):memberUsers).slice().sort((a,b)=>{
      const urgency=user=>!user.enabled?3:!user.active?0:Number(user.accessUntilMs)<=Date.now()+3*24*60*60*1000?1:2;
      const difference=urgency(a)-urgency(b);if(difference)return difference;
      return (Number(a.accessUntilMs)||0)-(Number(b.accessUntilMs)||0);
    });
    $('member-search-count').textContent=query?visibleUsers.length+' av '+memberUsers.length+' kunder':'Visar '+memberUsers.length+' kunder';
    if(!memberUsers.length){$('members-list').replaceChildren(Object.assign(document.createElement('p'),{className:'member-empty',textContent:'Inga medlemskonton ännu.'}));return;}
    if(!visibleUsers.length){$('members-list').replaceChildren(Object.assign(document.createElement('p'),{className:'member-empty',textContent:'Inga kunder matchar din sökning.'}));return;}
    $('members-list').replaceChildren(...visibleUsers.map(user=>{
      const card=document.createElement('article');card.className='member-card';
      const heading=document.createElement('div');heading.className='member-card-heading';
      const title=document.createElement('strong');title.textContent=user.firstName+' '+user.lastName;
      const badge=document.createElement('span');badge.className='member-badge '+(user.active?'active':'expired');badge.textContent=user.active?'Aktiv · '+user.daysLeft+' d kvar':user.enabled?'Åtkomst utgången':'Pausad';
      const email=document.createElement('p');email.textContent=user.email;
      const expiryLabel=user.accessUntilMs?new Date(user.accessUntilMs).toLocaleString('sv-SE'):'ingen sluttid';
      const sub=document.createElement('p');sub.className='member-meta';sub.textContent=(user.active?'Åtkomst till ':'Slutade eller saknas · åtkomst till ')+expiryLabel+' · dator '+(user.devices.computer?'upptagen':'ledig')+' · mobil '+(user.devices.mobile?'upptagen':'ledig');
      heading.append(title,badge);card.append(heading,email,sub);
      const form=document.createElement('form');form.className='member-edit-form';
      form.append(memberField('Förnamn','text',user.firstName,'firstName',{maxLength:80,required:true}),memberField('Efternamn','text',user.lastName,'lastName',{maxLength:80,required:true}));
      const expiry=user.accessUntilMs?new Date(user.accessUntilMs):null;
      const dateValue=expiry?expiry.getFullYear()+'-'+String(expiry.getMonth()+1).padStart(2,'0')+'-'+String(expiry.getDate()).padStart(2,'0'):'';
      form.append(memberField('Åtkomst till','date',dateValue,'accessUntil'));
      form.append(memberField('Nytt lösenord (valfritt)','password','','newPassword',{minLength:10,maxLength:128,autocomplete:'new-password'}));
      const enabledLabel=document.createElement('label');enabledLabel.className='member-enabled';const enabled=document.createElement('input');enabled.type='checkbox';enabled.name='enabled';enabled.checked=user.enabled;enabledLabel.append(enabled,document.createTextNode(' Konto aktivt'));form.append(enabledLabel);
      const actions=document.createElement('div');actions.className='member-actions';
      const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='Spara ändringar';
      const reset=document.createElement('button');reset.type='button';reset.textContent='Återställ enheter';reset.addEventListener('click',async()=>{
        reset.disabled=true;reset.textContent='Återställer…';
        try{await memberRequest('/api/admin/members/'+encodeURIComponent(user.id)+'/reset-devices',{method:'POST',body:'{}'});await refreshMembership();$('members-state').textContent='Enhetsinloggningarna återställdes för '+user.firstName+' '+user.lastName+'.';}
        catch(error){$('members-state').textContent=error.message;reset.disabled=false;reset.textContent='Försök igen';}
      });
      const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Ta bort konto';remove.addEventListener('click',async()=>{
        if(!window.confirm('Ta bort kontot för '+user.firstName+' '+user.lastName+'? Kunden kan inte logga in efteråt och kontots betalningshistorik tas bort.'))return;
        remove.disabled=true;remove.textContent='Tar bort…';
        try{await memberRequest('/api/admin/members/'+encodeURIComponent(user.id),{method:'DELETE'});await refreshMembership();$('members-state').textContent='Kontot för '+user.firstName+' '+user.lastName+' togs bort.';}
        catch(error){$('members-state').textContent=error.message;remove.disabled=false;remove.textContent='Försök igen';}
      });
      actions.append(save,reset,remove);form.append(actions);
      form.addEventListener('submit',async event=>{
        event.preventDefault();save.disabled=true;save.textContent='Sparar…';
        const date=form.elements.accessUntil.value;
        const changes={firstName:form.elements.firstName.value,lastName:form.elements.lastName.value,paidUntilMs:date?Date.parse(date+'T23:59:59.999'):0,enabled:form.elements.enabled.checked};
        if(form.elements.newPassword.value)changes.password=form.elements.newPassword.value;
        try{await memberRequest('/api/admin/members/'+encodeURIComponent(user.id),{method:'PATCH',body:JSON.stringify(changes)});await refreshMembership();$('members-state').textContent='Medlemsuppgifterna sparades.';}
        catch(error){$('members-state').textContent=error.message;save.disabled=false;save.textContent='Försök igen';}
      });
      const timeForm=document.createElement('form');timeForm.className='member-time-form individual-time-form';
      timeForm.append(memberField('Lägg till dagar','number',1,'days',{min:0,max:3650,step:1,required:true}),memberField('Lägg till timmar','number',0,'hours',{min:0,max:23,step:1,required:true}));
      const grant=document.createElement('button');grant.type='submit';grant.textContent='Lägg till tid';timeForm.append(grant);
      timeForm.addEventListener('submit',async event=>{
        event.preventDefault();grant.disabled=true;grant.textContent='Lägger till…';
        try{const result=await memberRequest('/api/admin/members/'+encodeURIComponent(user.id)+'/add-time',{method:'POST',body:JSON.stringify({days:Number(timeForm.elements.days.value),hours:Number(timeForm.elements.hours.value)})});const refreshed=await refreshMembership();$('members-state').textContent=refreshed?'La till tid för '+user.firstName+' '+user.lastName+'. Ny sluttid: '+new Date(result.user.accessUntilMs).toLocaleString('sv-SE')+'.':'Tiden lades till, men listan kunde inte uppdateras. Tryck på Uppdatera.';}
        catch(error){$('members-state').textContent=error.message;grant.disabled=false;grant.textContent='Försök igen';}
      });
      card.append(form,timeForm);return card;
    }));
  }
  async function refreshMembership(){
    const generation=authGeneration;
    try{
      const data=await memberRequest('/api/admin/members');if(generation!==authGeneration||!authorization)return;
      memberUsers=Array.isArray(data.users)?data.users:[];memberPayments=Array.isArray(data.payments)?data.payments:[];
      priorityStatus.members='ready';renderPriorityQueue();
      const currentMemberIds=new Set(memberUsers.map(user=>user.id));
      if(knownMemberIds)for(const user of memberUsers)if(!knownMemberIds.has(user.id))notifyAdmin('Nytt kundkonto',user.firstName+' '+user.lastName+' · '+user.email+' · tilldela åtkomsttid.');
      knownMemberIds=currentMemberIds;
      const current=new Set(memberPayments.filter(payment=>payment.status==='pending'&&payment.paidRequested).map(payment=>payment.id));
      if(reportedPaymentIds)for(const id of current)if(!reportedPaymentIds.has(id)){const payment=memberPayments.find(item=>item.id===id);if(payment)notifyAdmin('Swishbetalning att godkänna','Betalare: '+[payment.reportedFirstName,payment.reportedLastName].filter(Boolean).join(' ')+' · Konto: '+payment.firstName+' '+payment.lastName+' · '+payment.amount+' kr för '+payment.durationDays+' dagar · ref '+payment.reference);}
      reportedPaymentIds=current;
      renderMemberStats();renderPayments();renderMembers();
      $('members-state').textContent=memberUsers.length+' kundkonton · du styr åtkomsttiden direkt.';
      return true;
    }catch(error){if(generation===authGeneration&&authorization){priorityStatus.members='error';renderPriorityQueue();$('members-state').textContent=error.message;}return false;}
  }
  $('member-refresh').addEventListener('click',refreshMembership);
  $('member-search').addEventListener('input',event=>{memberSearch=event.currentTarget.value;renderMembers();});
  $('bulk-grant-time-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');
    button.disabled=true;button.textContent='Lägger till tid…';
    try{
      const result=await memberRequest('/api/admin/members/grant-time',{method:'POST',body:JSON.stringify({days:Number(form.elements.days.value),hours:Number(form.elements.hours.value)})});
      const refreshed=await refreshMembership();$('members-state').textContent=refreshed?'La till tiden på '+result.updated+' konton utan aktiv åtkomst.':'Tiden lades till, men listan kunde inte uppdateras. Tryck på Uppdatera.';
    }catch(error){$('members-state').textContent=error.message;}
    finally{button.disabled=false;button.textContent='Lägg till tid till alla utan aktiv åtkomst';}
  });
  $('add-member-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;button.textContent='Skapar…';
    const accessDays=Number(form.elements.accessDays.value);
      try{const data=Object.fromEntries(new FormData(form));const result=await memberRequest('/api/admin/members',{method:'POST',body:JSON.stringify(data)});if(knownMemberIds)knownMemberIds.add(result.user.id);form.reset();$('member-search').value='';memberSearch='';const refreshed=await refreshMembership();$('members-state').textContent=refreshed?'Kundkontot skapades med '+accessDays+' dagars åtkomst.':'Kundkontot skapades, men listan kunde inte uppdateras. Tryck på Uppdatera.';}
    catch(error){$('members-state').textContent=error.message;}
    finally{button.disabled=false;button.textContent='Skapa kund med vald åtkomst';}
  });
  async function refresh() {
    if (pending) return;
    if (!authorization || Date.now() >= expires) return clearAdminView();
    pending = true;
    const generation=authGeneration;
    let healthCheckFailed=true;
    try {
      const response = await fetch('/api/admin/status', { headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
      healthCheckFailed=response.status>=500;
      const data = await response.json();
      if(generation!==authGeneration || !authorization)return;
      if (!response.ok) { if(response.status===401 || response.status===403)clearAdminView(); throw Error(data.error || 'Status kunde inte hämtas'); }
      reportHealth(true);
      $('message').textContent = '';
      traffic=data.traffic;renderTraffic();
      $('login').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
      $('active-count').textContent = typeof data.activeSessions === 'number' ? data.activeSessions : '—';
      $('recent-count').textContent = typeof data.recentVisitors === 'number' ? data.recentVisitors : '—';
      const connected = data.presence?.source === 'redis';
      databaseConnected=connected;
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
      $('updated').textContent = 'Senast kontrollerad ' + new Date(data.checkedAt).toLocaleTimeString('sv-SE') + ' · uppdateras varje minut';
      await refreshMembership();
      await refreshBans();
      await refreshReports();
      await refreshConversations();
      renderPriorityQueue();
    } catch (error) { databaseConnected=false;if(healthCheckFailed&&authorization)reportHealth(false,error.message);$('message').textContent = error.message;renderPriorityQueue(); }
    finally { if(generation===authGeneration)pending = false; }
  }
  $('login').addEventListener('submit', async event => {
    event.preventDefault();
    const button=$('login').querySelector('button[type="submit"]'),password=$('password').value,rememberDevice=$('remember-admin').checked;
    button.disabled=true;button.textContent='Kontrollerar…';$('message').textContent='';
    try{
      const response=await fetch('/api/admin/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({password,rememberDevice}),cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Admininloggningen misslyckades.');
      authorization='Session';expires=Number(data.rememberUntil)||Date.now()+(rememberDevice?30:0.5)*24*60*60*1000;
      $('password').value='';clearInterval(timer);await refresh();
      if(authorization&&$('login').hidden){timer=setInterval(()=>{if(!document.hidden)refresh();},60000);await syncAdminSubscription();}
    }catch(error){authorization='';expires=0;$('message').textContent=error.message||'Admininloggningen misslyckades.';}
    finally{button.disabled=false;button.textContent='Öppna admin';}
  });
  $('logout').addEventListener('click', logoutAdmin);
  $('refresh').addEventListener('click', refresh);
  $('notifications').addEventListener('click',async()=>{
    if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window)){ setNoticeMessage('Den här webbläsaren stöder inte pushnotiser.');return; }
    if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches){setNoticeMessage('På iPhone: lägg först TR-os på hemskärmen och öppna admin därifrån.');return;}
    try{
      const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      if(permission!=='granted'){ $('notifications').textContent=permission==='denied'?'Notiser blockerade':'Aktivera push';setNoticeMessage('Tillåt notiser i enhetens webbplatsinställningar för att få pushnotiser.');return; }
      $('notifications').disabled=true;setNoticeMessage('Ansluter den här enheten…');
      const keyResponse=await fetch('/api/push/vapid-public',{cache:'no-store',signal:AbortSignal.timeout(10000)}),keyData=await keyResponse.json();
      if(!keyResponse.ok||!keyData.publicKey)throw Error(keyData.error||'Pushnotiser är inte tillgängliga just nu.');
      const registration=await navigator.serviceWorker.register('/push-sw.js?v=20261020.2',{scope:'/push/'});
      const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey(keyData.publicKey)});
      await saveAdminSubscription(subscription);
    }catch(error){setNoticeMessage(error.message||'Notiser kunde inte aktiveras på den här enheten.');}
    finally{$('notifications').disabled=false;}
  });
  window.addEventListener('pagehide', clearAdminView);
  (async()=>{
    authorization='Session';expires=Date.now()+30*24*60*60*1000;
    await refresh();
    if(authorization&&$('login').hidden){timer=setInterval(()=>{if(!document.hidden)refresh();},60000);await syncAdminSubscription();}
    else $('message').textContent='';
  })();
})();
