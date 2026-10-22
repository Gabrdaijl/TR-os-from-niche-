const clickSound=(()=>{let ctx=null;let buf=null;const ensureCtx=()=>{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;if(!ctx)ctx=new AC;if(ctx.state==="suspended")ctx.resume();return ctx};if(window.AudioContext||window.webkitAudioContext){window.TR_OS.fetch("click.wav",{cache:"force-cache"}).then(r=>r.arrayBuffer()).then(ab=>{const c=ensureCtx();if(!c)return;c.decodeAudioData(ab,b=>{buf=b},()=>{})}).catch(()=>{})}document.addEventListener("pointerdown",()=>ensureCtx(),{capture:true,passive:true});const play=()=>{const c=ensureCtx();if(!c||!buf)return;const src=c.createBufferSource();src.buffer=buf;const g=c.createGain();g.gain.value=.5;src.connect(g);g.connect(c.destination);src.start(0)};document.addEventListener("pointerdown",e=>{if(e.target&&e.target.closest&&e.target.closest("button"))play()},true);return play})();window.trosClick=clickSound;const pageLoader=document.getElementById("page-loader");const mainFrame=document.getElementById("mainFrame");let loaderTimer=null;let loaderTextTimer=null;function showLoader(){clearTimeout(loaderTimer);clearTimeout(loaderTextTimer);clearTimeout(window._loaderSafe);const spinner=pageLoader.querySelector(".spin-n");if(spinner){spinner.style.animation="none";void spinner.offsetWidth;spinner.style.animation=""}pageLoader.classList.remove("swipe-out");pageLoader.style.display="flex";loaderTextTimer=setTimeout(()=>{const t=document.getElementById("loader-text");if(t)t.style.display="block"},3e3);window._loaderSafe=setTimeout(hideLoader,15e3)}function hideLoader(){clearTimeout(loaderTimer);clearTimeout(loaderTextTimer);clearTimeout(window._loaderSafe);const t=document.getElementById("loader-text");if(t)t.style.display="none";pageLoader.classList.add("swipe-out");loaderTimer=setTimeout(()=>{pageLoader.style.display="none"},180);mainFrame.classList.remove("page-exit");mainFrame.classList.remove("page-enter");void mainFrame.offsetWidth;mainFrame.classList.add("page-enter")}function changePage(page){try{const cur=new URL(mainFrame.getAttribute("src")||mainFrame.src,location.href).href;const next=new URL(page,location.href).href;if(cur===next){hideLoader();return}}catch(e){}var bundled=null;try{bundled=typeof oneSrc==="function"?oneSrc(page):null}catch(e){bundled=null}showLoader();mainFrame.classList.remove("page-enter");mainFrame.classList.add("page-exit");clearTimeout(window._pageSwap);window._pageSwap=setTimeout(()=>{if(bundled!==null){try{mainFrame.removeAttribute("src")}catch(e){}mainFrame.srcdoc=bundled}else{try{mainFrame.removeAttribute("srcdoc")}catch(e){}mainFrame.src=page}},80)}mainFrame.addEventListener("load",hideLoader);window.addEventListener("load",hideLoader,{once:true});setTimeout(hideLoader,15000);/* TR-os chat synchronization start */
(async () => {
  const runtime = window.TR_OS;
  let initialIdentity = null, initialIdentityFailed = false;
  try { initialIdentity = await runtime.identity(); } catch { initialIdentityFailed = true; }
  const ORIGIN = runtime.apiBase;
  const xfetch = (path, options) => runtime.fetch(path, Object.assign({
    cache: "no-store", signal: AbortSignal.timeout(10000)
  }, options));
  const pop = document.getElementById("chat-pop");
  const fromEl = document.getElementById("chat-pop-from");
  const msgsEl = document.getElementById("chat-pop-msgs");
  const input = document.getElementById("chat-pop-input");
  let self = initialIdentity?.token || "", selfSecret = initialIdentity?.secret || "";
  function refreshSelf() {
    try {
      self = localStorage.getItem("tros-online-id") || self;
      selfSecret = localStorage.getItem("tros-online-secret") || selfSecret;
    } catch {}
  }
  refreshSelf();
  let peer = null, peerName = "Chat", lastTs = Date.now(), opened = false;
  let popMode = "dm", roomLastTs = Date.now();
  const roomCache = [];
  let pending = false, requested = false, stopped = false, failures = 0, retryAt = 0;
  let fallbackTimer = null, reconnectTimer = null, subscribeTimer = null;
  let socket = null, socketReady = false, reconnectAttempts = 0;
  let identityRecovery = null, lastIdentityAttempt = initialIdentityFailed ? Date.now() : 0;

  function row(text, mine) {
    const element = document.createElement("div");
    element.className = "max-w-[85%] px-3 py-2 rounded-xl text-sm break-words " +
      (mine ? "self-end bg-blue-500 text-white" : "self-start bg-blue-200 text-blue-800 border border-blue-400");
    element.textContent = text;
    return element;
  }
  function renderRoomPop() {
    const box = document.getElementById("pop-gc-msgs");
    if (!box) return;
    box.innerHTML = "";
    roomCache.slice(-40).forEach(message => {
      const mine = message.from === self;
      const element = document.createElement("div");
      element.className = "max-w-[90%] px-3 py-2 rounded-xl text-sm break-words " +
        (mine ? "self-end bg-blue-500 text-white" : "self-start bg-blue-200 text-blue-800 border border-blue-400");
      const name = document.createElement("div");
      name.className = "text-xs font-bold opacity-80";
      name.textContent = mine ? "you" : message.fromName || "guest";
      const text = document.createElement("div");
      text.textContent = message.text;
      element.appendChild(name);
      element.appendChild(text);
      box.appendChild(element);
    });
    box.scrollTop = box.scrollHeight;
  }
  function setPopMode(mode, refresh = true) {
    popMode = mode === "gc" ? "gc" : "dm";
    const direct = popMode === "dm";
    document.getElementById("pop-dm-view").hidden = !direct;
    document.getElementById("pop-gc-view").hidden = direct;
    document.getElementById("pop-tab-dm").style.opacity = direct ? "1" : ".5";
    document.getElementById("pop-tab-gc").style.opacity = direct ? ".5" : "1";
    if (!direct) {
      document.getElementById("pop-gc-dot").hidden = true;
      renderRoomPop();
      if (refresh) pollRoomPop();
    }
  }
  function acceptRoomMessages(list) {
    if (!Array.isArray(list) || !list.length) return;
    const seen = new Set(roomCache.map(message => message.id));
    let added = false;
    for (const message of list) {
      if (message.ts > roomLastTs) roomLastTs = message.ts;
      if (!seen.has(message.id)) {
        roomCache.push(message);
        seen.add(message.id);
        added = true;
      }
    }
    if (roomCache.length > 100) roomCache.splice(0, roomCache.length - 100);
    if (!added) return;
    if (popMode === "gc" && !pop.hidden) renderRoomPop();
    else if (list.some(message => message.from !== self)) {
      setPopMode("gc", false);
      pop.hidden = false;
      renderRoomPop();
    } else document.getElementById("pop-gc-dot").hidden = false;
  }
  function acceptInboxMessages(list) {
    if (!Array.isArray(list) || !list.length) return;
    for (const message of list) if (message.ts > lastTs) lastTs = message.ts;
    const latest = list[list.length - 1];
    peer = latest.from;
    peerName = latest.fromName || "Chat";
    fromEl.textContent = peerName;
    if (!opened) { msgsEl.innerHTML = ""; opened = true; }
    pop.hidden = false;
    for (const message of list) msgsEl.appendChild(row((message.fromName || "") + ": " + message.text, false));
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  async function pollRoomPop() {
    try {
      const response = await xfetch("/chat/room?since=" + roomLastTs);
      if (!response.ok || stopped) return;
      const data = await response.json();
      if (!stopped) acceptRoomMessages(data.messages);
    } catch {}
  }
  function subscribe(current) {
    refreshSelf();
    if (stopped || !current || current !== socket || current.readyState !== 1 || !self || !selfSecret) return;
    current.send(JSON.stringify({ type: "subscribe-chat", token: self, secret: selfSecret }));
    socketReady = false;
    clearTimeout(subscribeTimer);
    subscribeTimer = setTimeout(() => { if (current === socket && !socketReady) current.close(); }, 10000);
  }
  async function recoverIdentity() {
    if (identityRecovery) return identityRecovery;
    if (Date.now() - lastIdentityAttempt < 60000) return false;
    lastIdentityAttempt = Date.now();
    identityRecovery = (async () => {
      try {
        refreshSelf();
        const response = await xfetch("/online", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: self, secret: selfSecret })
        });
        if (!response.ok || stopped) return false;
        const data = await response.json();
        if (typeof data.token !== "string" || typeof data.secret !== "string") return false;
        self = data.token;
        selfSecret = data.secret;
        try {
          localStorage.setItem("tros-online-id", self);
          localStorage.setItem("tros-online-secret", selfSecret);
        } catch {}
        return true;
      } catch { return false; }
    })().finally(() => { identityRecovery = null; });
    return identityRecovery;
  }
  function armFallback() {
    clearTimeout(fallbackTimer);
    if (stopped) return;
    const remaining = retryAt - Date.now();
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (stopped) return;
      if (document.visibilityState !== "hidden" && (!socketReady || requested)) requestUpdates();
      else armFallback();
    }, Math.max(1000, remaining > 0 ? remaining : 60000));
  }
  function updatesPath() {
    return "/chat/updates?token=" + encodeURIComponent(self) + "&secret=" + encodeURIComponent(selfSecret) +
      "&roomSince=" + encodeURIComponent(roomLastTs) + "&inboxSince=" + encodeURIComponent(lastTs);
  }
  async function fetchUpdates() {
    pending = true;
    requested = false;
    try {
      refreshSelf();
      if ((!self || !selfSecret) && !(await recoverIdentity())) throw Error("Chat identity unavailable");
      let response = await xfetch(updatesPath());
      if (response.status === 401 && await recoverIdentity()) {
        subscribe(socket);
        response = await xfetch(updatesPath());
      }
      if (!response.ok) throw Error("Chat updates unavailable");
      const data = await response.json();
      if (!Array.isArray(data.room) || !Array.isArray(data.inbox)) throw Error("Invalid chat updates");
      if (stopped) return;
      acceptRoomMessages(data.room);
      acceptInboxMessages(data.inbox);
      failures = 0;
      retryAt = 0;
    } catch {
      failures = Math.min(failures + 1, 4);
      retryAt = Date.now() + Math.min(300000, 60000 * (2 ** (failures - 1)));
      requested = true;
    } finally {
      pending = false;
      if (!stopped && requested && Date.now() >= retryAt) Promise.resolve().then(requestUpdates);
      else armFallback();
    }
  }
  function requestUpdates() {
    if (stopped) return;
    requested = true;
    if (pending) return;
    if (Date.now() < retryAt) { armFallback(); return; }
    void fetchUpdates();
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (stopped || document.visibilityState === "hidden") return;
    const delay = Math.min(60000, 1000 * (2 ** Math.min(reconnectAttempts++, 6)));
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }
  function connect() {
    if (stopped || document.visibilityState === "hidden" || typeof WebSocket !== "function" ||
        (socket && (socket.readyState === 0 || socket.readyState === 1))) return;
    let current;
    try {
      const endpoint = new URL("/tros-ws", ORIGIN);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      current = new WebSocket(endpoint.href);
    } catch { scheduleReconnect(); return; }
    socket = current;
    socketReady = false;
    current.onopen = () => {
      if (stopped || current !== socket) return current.close();
      subscribe(current);
      if (!self || !selfSecret) current.close();
    };
    current.onmessage = event => {
      if (stopped || current !== socket) return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === "chat-ready") {
        socketReady = true;
        reconnectAttempts = 0;
        clearTimeout(subscribeTimer);
        if (!pending) requestUpdates();
      } else if (data.type === "chat-update" && socketReady) requestUpdates();
      else if (data.type === "chat-error") {
        socketReady = false;
        recoverIdentity().then(recovered => {
          if (stopped || current !== socket) return;
          if (recovered && current.readyState === 1) subscribe(current);
          else current.close();
        });
      }
    };
    current.onerror = () => { try { current.close(); } catch {} };
    current.onclose = event => {
      if (current !== socket) return;
      clearTimeout(subscribeTimer);
      socket = null;
      socketReady = false;
      if (event?.code === 1008) recoverIdentity().then(recovered => {
        if (stopped) return;
        if (recovered) { requestUpdates(); connect(); }
        else scheduleReconnect();
      });
      else scheduleReconnect();
      armFallback();
    };
  }

  async function send() {
    refreshSelf();
    const text = input.value.trim();
    if (!text || !peer) return;
    input.value = "";
    msgsEl.appendChild(row(text, true));
    msgsEl.scrollTop = msgsEl.scrollHeight;
    try {
      await xfetch("/chat/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: self, secret: selfSecret, to: peer, text })
      });
    } catch {}
  }
  async function gcSendPop() {
    refreshSelf();
    const field = document.getElementById("pop-gc-input");
    const text = field.value.trim();
    if (!text) return;
    field.value = "";
    try {
      await xfetch("/chat/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: self, secret: selfSecret, to: "all", text })
      });
    } catch {}
    pollRoomPop();
  }
  document.getElementById("chat-pop-send").addEventListener("click", send);
  input.addEventListener("keydown", event => { if (event.key === "Enter") send(); });
  document.getElementById("chat-pop-close").addEventListener("click", () => { pop.hidden = true; opened = false; });
  document.getElementById("pop-tab-dm").addEventListener("click", () => setPopMode("dm"));
  document.getElementById("pop-tab-gc").addEventListener("click", () => setPopMode("gc"));
  document.getElementById("pop-gc-send").addEventListener("click", gcSendPop);
  document.getElementById("pop-gc-input").addEventListener("keydown", event => { if (event.key === "Enter") gcSendPop(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") { requestUpdates(); connect(); }
  });
  window.addEventListener("online", () => {
    if (document.visibilityState !== "hidden") { requestUpdates(); connect(); }
  });
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearTimeout(fallbackTimer);
    clearTimeout(reconnectTimer);
    clearTimeout(subscribeTimer);
    const current = socket;
    socket = null;
    socketReady = false;
    if (current) { try { current.close(); } catch {} }
  });
  window.addEventListener("pageshow", event => {
    if (!stopped || !event.persisted) return;
    stopped = false;
    if (document.visibilityState !== "hidden") { requestUpdates(); connect(); }
    else armFallback();
  });
  if (document.visibilityState !== "hidden") requestUpdates();
  else armFallback();
  connect();
})();
/* TR-os chat synchronization end */
document.addEventListener("keydown",e=>{const k=(e.key||"").toLowerCase();if(e.key==="F12")e.preventDefault();else if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(k==="i"||k==="j"||k==="c"||k==="u"||k==="k"))e.preventDefault();else if((e.ctrlKey||e.metaKey)&&k==="u")e.preventDefault();else if(e.metaKey&&e.altKey&&(k==="i"||k==="j"||k==="c"||k==="u"))e.preventDefault()});document.addEventListener("contextmenu",e=>{try{const t=e.target;if(t&&t.closest&&t.closest("input, textarea"))return}catch(err){}e.preventDefault()},true);document.addEventListener("dblclick",e=>e.preventDefault(),true);document.addEventListener("selectstart",e=>{try{const t=e.target;if(t&&t.closest&&t.closest('input, textarea, [contenteditable="true"]'))return}catch(err){}e.preventDefault()},true);try{const savedCloak=JSON.parse(localStorage.getItem("tros-cloak")||"null");if(savedCloak&&typeof savedCloak==="object"){if(savedCloak.title)document.title=savedCloak.title;if(savedCloak.icon){let link=document.querySelector('link[rel="icon"]');if(!link){link=document.createElement("link");link.rel="icon";document.head.appendChild(link)}link.href=savedCloak.icon}}}catch(e){}function trosPanicHandler(e){let cfg=null;try{cfg=JSON.parse(localStorage.getItem("tros-panic")||"null")}catch(err){}if(!cfg||!cfg.key||!cfg.url)return;try{if(e.target&&e.target.closest&&e.target.closest('input, textarea, [contenteditable="true"]'))return}catch(err2){}if((e.key||"").toLowerCase()!==String(cfg.key).toLowerCase())return;if(!!e.ctrlKey!==!!cfg.ctrl)return;if(!!e.shiftKey!==!!cfg.shift)return;if(!!e.altKey!==!!cfg.alt)return;if(!!e.metaKey!==!!cfg.meta)return;e.preventDefault();try{e.stopPropagation()}catch(err3){}location.href=cfg.url}document.addEventListener("keydown",trosPanicHandler,true);window.addEventListener("message",e=>{try{if(e&&e.data&&e.data.__trosPanic&&typeof e.data.__trosPanic==="string")location.href=e.data.__trosPanic}catch(err4){}});function trosArmPanicFrames(win){const docs=[];try{if(win&&win.document)docs.push(win.document)}catch(err5){return}for(let i=0;i<docs.length;i++){const d=docs[i];try{if(!d.__trosPanicArmed){d.__trosPanicArmed=true;d.addEventListener("keydown",trosPanicHandler,true)}}catch(err6){}let frames=[];try{frames=d.querySelectorAll("iframe, frame")}catch(err7){}for(let j=0;j<frames.length;j++){try{const cw=frames[j].contentWindow;if(cw&&cw.document&&docs.indexOf(cw.document)===-1)docs.push(cw.document)}catch(err8){}}}}try{mainFrame.addEventListener("load",()=>{try{trosArmPanicFrames(window)}catch(err9){}})}catch(err10){}setInterval(()=>{try{trosArmPanicFrames(window)}catch(err11){}},2e3);try{trosArmPanicFrames(window)}catch(err12){}
