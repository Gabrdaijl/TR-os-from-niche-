const GNMATH_API = "https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json";
const GNMATH_COVER = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";
const GNMATH_HTML = "https://cdn.jsdelivr.net/gh/freebuisness/html@main";
const UGS_API = "https://cdn.jsdelivr.net/gh/Sea-Math/ugs-json@main/games.json";
const UGS_HTML_URL1 = "https://cdn.jsdelivr.net/gh/Sea-Math/ugs-1@main";
const UGS_HTML_URL2 = "https://cdn.jsdelivr.net/gh/Sea-Math/ugs-2@main";
const UGS_HTML_URL3 = "https://cdn.jsdelivr.net/gh/Sea-Math/ugs-3@main";
const DAKNUX_API_URLS = [
    "https://cdn.jsdelivr.net/gh/daknux/assets@latest/zones.json",
    "https://cdn.jsdelivr.net/gh/daknux/assets@master/zones.json"
];
let DAKNUX_API = DAKNUX_API_URLS[Math.floor(Math.random() * DAKNUX_API_URLS.length)];
const DAKNUX_COVER = "https://cdn.jsdelivr.net/gh/daknux/covers@main";
const DAKNUX_HTML = "https://cdn.jsdelivr.net/gh/daknux/html@main";
const FALLBACK_IMAGE = "../s3.envato.com/files/fed15e2f-5abf-4758-a1a2-3e3d68013f0d/inline_image_preview.jpg";
const NEBULA_BASE = "https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@main";
const NEBULA_API = `${NEBULA_BASE}/games.json`;

const CKV_URL = "https://raw.githack.com/carbonicality/ChickenKingsVault/main";
const CKV_ICONS_URL = "https://cdn.jsdelivr.net/gh/carbonicality/ChickenKingsVault@main";

class LumiSDK {
    static urlCache = new Map();
    static htmlCache = new Map();
    constructor() {
        this.games = [];
        this.filteredGames = [];
        this.currentPage = 1;
        this.currentSearch = "";
        this.currentSource = "All";
        this.currentGameUrl = "";
        this.currentGameHtml = "";
        this.currentGameTitle = "game";
        this.loaded = false;

        this.config = {
            container: '#games',
            columns: 8,
            rows: 4,
            gamesPerPage: 32,
            fontFamily: "'Inter', 'Poppins', 'Segoe UI', sans-serif"
        };

        this.colors = {
            menuBackground: "transparent", gameBackground: "red", text: "#ffffff",
            searchBackground: "transparent", searchBorder: "#222", searchFocus: "#555",
            dropdownBackground: "#0a0a0a", dropdownBorder: "#222", cardBackground: "#050505",
            cardBorder: "#1a1a1a", cardHoverBorder: "#444", badgeBackground: "rgba(0,0,0,0.9)",
            badgeText: "#ffffff", randomBtnBg: "#ffffff", randomBtnText: "#000000",
            randomBtnHover: "#e0e0e0", pageBtnBg: "#0a0a0a", pageBtnText: "#ffffff",
            pageBtnBorder: "#222", pageBtnActiveBg: "#ffffff", pageBtnActiveText: "#000000",
            actionBtnBorder: "#333", backBtnBg: "#aa2e25", backBtnHover: "#d32f2f",
            backBtnText: "#ffffff", downloadBtnBg: "#000000", downloadBtnHover: "#1a1a1a",
            downloadBtnText: "#ffffff", blankBtnBg: "#000000", blankBtnHover: "#1a1a1a",
            blankBtnText: "#ffffff", fullscreenBtnBg: "#0a0a0a", fullscreenBtnHover: "#1a1a1a",
            fullscreenBtnText: "#ffffff"
        };
    }

    async init(options = {}) {
        this.config = { ...this.config, ...options };
        if (options.colors) {
            this.colors = { ...this.colors, ...options.colors };
        }

        if (!options.headless && options.container) {
            this.container = document.querySelector(this.config.container);
            if (this.container && !this.wrapper) {
                this.injectStyles();
                this.buildUI();
                this.applyFilters();
            }
        }
        try {
            if (!this.loaded) {
                this._loadPromise ||= this.loadGames().then(() => { this.loaded = true; });
                await this._loadPromise;
            }
        } catch (err) {
            this._loadPromise = null;
            if (typeof options.onError === 'function') { options.onError(err); return; }
            throw err;
        }
        this.updateView();
        if (typeof options.onReady === 'function') options.onReady();
    }

    _gameId(game, index) {
        const slug = (game.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return `${game.source}_${index}_${slug}`;
    }

    async getGames(options = {}) {
        if (!this.loaded) {
            await this.init({ headless: true });
        }

        const page = options.page || 1;
        const limit = options.limit || 50;
        const q = (options.q || "").toLowerCase().trim();

        let filtered = this.games;
        if (q) {
            filtered = this.games.filter(g => g.title.toLowerCase().includes(q));
        }

        const totalPages = Math.ceil(filtered.length / limit);
        const start = (page - 1) * limit;
        const pageGames = filtered.slice(start, start + limit);

        return {
            games: pageGames.map((g) => {
                const globalIndex = this.games.indexOf(g);
                return {
                    id: this._gameId(g, globalIndex),
                    name: g.title,
                    image_token: g.cover,
                    url: g.url,
                    source: g.source
                };
            }),
            pages: totalPages || 1
        };
    }

    async getImageUrl(image_token) {
        if (!image_token) return FALLBACK_IMAGE;
        return image_token;
    }

    prepareGameHtml(htmlText, game, url) {
        const defaultHtmlUrl = game.source === 'GNMath' ? GNMATH_HTML : game.source === 'Daknux' ? DAKNUX_HTML : UGS_HTML_URL1;
        const defaultCoverUrl = game.source === 'GNMath' ? GNMATH_COVER : game.source === 'Daknux' ? DAKNUX_COVER : UGS_HTML_URL1.replace('/ugs-1@main', '/ugs-covers@main');

        htmlText = htmlText
            .replace(/{HTML_URL1}/gi, UGS_HTML_URL1)
            .replace(/%7BHTML_URL1%7D/gi, UGS_HTML_URL1)
            .replace(/{HTML_URL2}/gi, UGS_HTML_URL2)
            .replace(/%7BHTML_URL2%7D/gi, UGS_HTML_URL2)
            .replace(/{HTML_URL3}/gi, UGS_HTML_URL3)
            .replace(/%7BHTML_URL3%7D/gi, UGS_HTML_URL3)
            .replace(/{HTML_URL}/gi, defaultHtmlUrl)
            .replace(/%7BHTML_URL%7D/gi, defaultHtmlUrl)
            .replace(/{COVER_URL}/gi, defaultCoverUrl)
            .replace(/%7BCOVER_URL%7D/gi, defaultCoverUrl);

        htmlText = htmlText.replace(/(src|href|action|data)=(['"])\/([^/])/gi, '$1=$2$3');

        const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

        if (!/<base\b[^>]*>/i.test(htmlText)) {
            const baseTag = `<base href="${baseUrl}">`;
            if (htmlText.match(/<head[^>]*>/i)) {
                htmlText = htmlText.replace(/(<head[^>]*>)/i, `$1\n    ${baseTag}`);
            } else {
                htmlText = `${baseTag}\n${htmlText}`;
            }
        }

        // Strip known ad tags before parsing can start their network requests.
        const parsed = new DOMParser().parseFromString(htmlText, 'text/html');
        const adHost = /(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|adsterra\.com|profitablecpmrate\.com|profitableratecpm\.com|highperformanceformat\.com|effectivegatecpm\.com|popads\.net|popcash\.net|onclicka\.com|exoclick\.com|adskeeper\.com|mgid\.com)$/i;
        for (const el of parsed.querySelectorAll('script[src],iframe[src],img[src],link[href]')) {
            try { if (adHost.test(new URL(el.getAttribute('src') || el.getAttribute('href'), baseUrl).hostname)) el.remove(); } catch {}
        }
        const blocker = parsed.createElement('script');
        blocker.src = window.TR_OS.assetUrl('frame-controls.js?v=20261020.7');
        parsed.head.prepend(blocker);
        return '<!doctype html>\n' + parsed.documentElement.outerHTML;
    }

    async warmGame(game) {
        if (!game) return null;
        if (game._html) return game._html;
        if (game._warming) return game._warming;
        if (game._resolvedUrl && LumiSDK.htmlCache.has(game._resolvedUrl)) {
            game._html = LumiSDK.htmlCache.get(game._resolvedUrl);
            return game._html;
        }
        game._warming = (async () => {
            let url = game.url;
            if (game.source === "Lumin") {
                const playUrl = await this.resolveLuminUrl(game.url);
                if (!playUrl) return null;
                game._resolvedUrl = playUrl;
                url = playUrl;
            }
            if (LumiSDK.htmlCache.has(url)) return game._html = LumiSDK.htmlCache.get(url);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Game download failed');
            game._html = this.prepareGameHtml(await response.text(), game, url);
            LumiSDK.htmlCache.set(url, game._html);
            if (LumiSDK.htmlCache.size > 20) {
                LumiSDK.htmlCache.delete(LumiSDK.htmlCache.keys().next().value);
            }
            return game._html;
        })().catch(() => null).finally(() => { game._warming = null; });
        return game._warming;
    }

    async loadGame(id) {
        if (!this.loaded && !this.games.length) {
            await this.init({ headless: true });
        }

        let game = this.games.find((g, i) => this._gameId(g, i) === id);
        if (!game) {
            console.error("Game not found:", id);
            return null;
        }

        const playRequest = this._playRequest = (this._playRequest || 0) + 1;

        let targetIframe;
        let playerWrapper = document.querySelector('.lumin-player');

        if (this.gameView && this.iframe) {
            targetIframe = this.iframe;
            this.menuView.style.display = 'none';
            this.gameView.style.display = 'block';
            this.currentGameUrl = game.url;
            this.currentGameTitle = game.title || "game";
        } else {
            if (!playerWrapper) {
                playerWrapper = document.createElement('div');
                playerWrapper.className = 'lumin-player';
                playerWrapper.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;display:none;';
                
                const flyout = document.createElement('div');
                flyout.className = 'lumin-player-flyout';
                flyout.style.cssText = 'position:absolute;inset:0;background:#000;';
                
                targetIframe = document.createElement('iframe');
                targetIframe.className = 'lumin-player-iframe';
                targetIframe.style.cssText = 'width:100%;height:100%;border:none;background:#000;';
                targetIframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-modals');
                targetIframe.setAttribute('allowfullscreen', 'true');
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'lumin-player-close';
                closeBtn.innerHTML = '&times;';
                closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;width:40px;height:40px;background:#fff;color:#000;border:none;border-radius:50%;font-size:24px;cursor:pointer;z-index:10000;display:flex;align-items:center;justify-content:center;';
                closeBtn.onclick = () => {
                    this._playRequest = (this._playRequest || 0) + 1;
                    playerWrapper.style.display = 'none';
                    targetIframe.srcdoc = '';
                    targetIframe.src = '';
                };

                const backBtn = document.createElement('button');
                backBtn.className = 'lumin-player-back';
                backBtn.innerHTML = '&#8592;';
                backBtn.style.cssText = 'position:absolute;top:20px;left:20px;width:40px;height:40px;background:#fff;color:#000;border:none;border-radius:50%;font-size:24px;cursor:pointer;z-index:10000;display:flex;align-items:center;justify-content:center;';
                backBtn.onclick = () => {
                    this._playRequest = (this._playRequest || 0) + 1;
                    playerWrapper.style.display = 'none';
                    targetIframe.srcdoc = '';
                    targetIframe.src = '';
                };

                const fsBtn = document.createElement('button');
                fsBtn.className = 'lumin-player-fullscreen';
                fsBtn.innerHTML = '&#9974;';
                fsBtn.style.cssText = 'position:absolute;top:20px;left:70px;width:40px;height:40px;background:#fff;color:#000;border:none;border-radius:50%;font-size:20px;cursor:pointer;z-index:10000;display:flex;align-items:center;justify-content:center;';
                fsBtn.onclick = () => {
                    try {
                        if (document.fullscreenElement) document.exitFullscreen();
                        else if (playerWrapper.requestFullscreen) playerWrapper.requestFullscreen();
                    } catch {}
                };
                
                flyout.appendChild(targetIframe);
                flyout.appendChild(closeBtn);
                flyout.appendChild(backBtn);
                flyout.appendChild(fsBtn);
                playerWrapper.appendChild(flyout);
                document.body.appendChild(playerWrapper);
            } else {
                targetIframe = playerWrapper.querySelector('.lumin-player-iframe');
            }
            playerWrapper.style.display = 'block';
        }

        const html = await this.warmGame(game);
        if (playRequest !== this._playRequest) return null;
        const url = game._resolvedUrl || (game.source !== 'Lumin' ? game.url : null);
        this.currentGameUrl = url || '';
        if (html) { this.currentGameHtml = html; targetIframe.srcdoc = html; }
        else if (url) { targetIframe.removeAttribute('srcdoc'); targetIframe.src = url; }
        return url;
    }

    injectStyles() {
        if (document.getElementById('lumi-styles')) {
            document.getElementById('lumi-styles').remove();
        }

        const c = this.colors;
        const style = document.createElement('style');
        style.id = 'lumi-styles';

        style.innerHTML = `
            .lumi-wrapper { font-family: ${this.config.fontFamily}; background: ${c.menuBackground}; color: ${c.text}; width: 100vw; height: 100vh; padding: 2vh 2vw; box-sizing: border-box; display: flex; flex-direction: column; }
            .lumi-wrapper *, .lumi-wrapper *::before, .lumi-wrapper *::after { box-sizing: border-box; }
            .lumi-menu-view { display: flex; flex-direction: column; height: 100%; width: 100%; }
            .lumi-header { flex-shrink: 0; display: flex; gap: 1vw; margin-bottom: 2vh; align-items: center; }
            .lumi-search { flex-grow: 1; padding: 1.5vh 1.5vw; border: 1px solid ${c.searchBorder}; border-radius: 8px; background: ${c.searchBackground}; color: ${c.text}; font-size: max(14px, 1vw); outline: none; transition: all 0.3s ease; }
            .lumi-search:focus { border-color: ${c.searchFocus}; }
            .lumi-search::placeholder { color: #666; }
            .lumi-source-select { padding: 1.5vh 1.5vw; border: 1px solid ${c.dropdownBorder}; border-radius: 8px; background: ${c.dropdownBackground}; color: ${c.text}; font-size: max(14px, 1vw); outline: none; cursor: pointer; transition: all 0.3s ease; }
            .lumi-source-select:hover { filter: brightness(1.2); }
            .lumi-btn { background: ${c.randomBtnBg}; color: ${c.randomBtnText}; border: none; padding: 1.5vh 2vw; border-radius: 8px; cursor: pointer; font-size: max(13px, 0.9vw); font-weight: 700; transition: all 0.2s ease; text-transform: uppercase; }
            .lumi-btn:hover { background: ${c.randomBtnHover}; transform: translateY(-2px); }
            .lumi-btn:disabled { cursor: default; transform: none; }
            .lumi-btn:active { transform: translateY(1px); }
            .lumi-grid { flex-grow: 1; display: grid; grid-template-columns: repeat(${this.config.columns}, 1fr); grid-template-rows: repeat(${this.config.rows}, 1fr); gap: 1.5vh 1vw; min-height: 0; }
            .lumi-game-card { background: ${c.cardBackground}; border-radius: 12px; overflow: hidden; position: relative; transition: all 0.2s ease; cursor: pointer; border: 1px solid ${c.cardBorder}; width: 100%; height: 100%; }
            .lumi-game-card:hover { transform: scale(1.02); border-color: ${c.cardHoverBorder}; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 10; }
            .lumi-game-img { width: 100%; height: 100%; object-fit: cover; transition: all 0.3s ease; }
            .lumi-noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px; font-weight: 700; font-size: max(12px, 0.9vw); color: #fff; background: linear-gradient(135deg, #1a2b4a 0%, #0a0a0a 100%); }
            .lumi-game-card:hover .lumi-game-img { filter: brightness(0.6); transform: scale(1.05); }
            .lumi-badge { position: absolute; top: 8px; right: 8px; background: ${c.badgeBackground}; color: ${c.badgeText}; font-size: max(9px, 0.7vw); font-weight: 700; padding: 4px 8px; border-radius: 6px; z-index: 2; border: 1px solid #333; text-transform: uppercase; }
            .lumi-game-title-overlay { position: absolute; bottom: 0; left: 0; width: 100%; background: linear-gradient(to top, #000 0%, rgba(0,0,0,0.9) 60%, transparent 100%); color: ${c.text}; padding: 20px 10px 10px 10px; font-size: max(12px, 0.9vw); font-weight: 700; text-align: center; opacity: 0; transition: opacity 0.2s ease; pointer-events: none; z-index: 2; }
            .lumi-game-card:hover .lumi-game-title-overlay { opacity: 1; }
            .lumi-pagination { flex-shrink: 0; display: flex; justify-content: center; gap: 0.5vw; margin-top: 2vh; }
            .lumi-page-btn { padding: 1vh 1.5vw; border: 1px solid ${c.pageBtnBorder}; background: ${c.pageBtnBg}; color: ${c.pageBtnText}; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; font-weight: 600; font-size: max(13px, 0.9vw); }
            .lumi-page-btn:hover { filter: brightness(1.2); }
            .lumi-page-btn.active { background: ${c.pageBtnActiveBg}; color: ${c.pageBtnActiveText}; border-color: ${c.pageBtnActiveBg}; }
            .lumi-game-view { display: none; position: relative; width: 100%; height: 100%; background: ${c.gameBackground}; border-radius: 12px; overflow: hidden; border: 1px solid #222; }
            .lumi-iframe { width: 100%; height: 100%; border: none; background: transparent; }
            .lumi-toolbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 10px; z-index: 10; }
            .lumi-action-btn { border: 1px solid ${c.actionBtnBorder}; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 13px; transition: all 0.2s ease; }
            .lumi-back-btn { background: ${c.backBtnBg}; color: ${c.backBtnText}; }
            .lumi-back-btn:hover { background: ${c.backBtnHover}; }
            .lumi-download-btn { background: ${c.downloadBtnBg}; color: ${c.downloadBtnText}; }
            .lumi-download-btn:hover { background: ${c.downloadBtnHover}; }
            .lumi-fullscreen-btn { background: ${c.fullscreenBtnBg}; color: ${c.fullscreenBtnText}; }
            .lumi-fullscreen-btn:hover { background: ${c.fullscreenBtnHover}; }
        `;

        document.head.appendChild(style);
    }

    buildUI() {
        this.container.innerHTML = `
            <div class="lumi-wrapper" id="lumi-main-wrapper">
                <div class="lumi-menu-view">
                    <div class="lumi-header">
                        <select class="lumi-source-select">
                            <option value="All">All Sources</option>
                            <option value="Lumin">Lumin</option>
                            <option value="CKV">Chicken Kings Vault</option>
                            <option value="GNMath">GNMath</option>
                            <option value="UGS">UGS</option>
                            <option value="Daknux">Daknux</option>
                            <option value="Nebula">Nebula</option>
                        </select>
                        <input type="text" class="lumi-search" placeholder="Search games...">
                        <button class="lumi-btn lumi-count" disabled>… games</button>
                    </div>
                    <div class="lumi-grid"></div>
                    <div class="lumi-pagination"></div>
                </div>
                <div class="lumi-game-view">
                    <div class="lumi-toolbar">
                        <button class="lumi-action-btn lumi-back-btn">Back</button>
                        <button class="lumi-action-btn lumi-fullscreen-btn">Fullscreen</button>
                    </div>
                    <iframe class="lumi-iframe" src="" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allowfullscreen></iframe>
                </div>
            </div>
        `;

        this.wrapper = this.container.querySelector('#lumi-main-wrapper');
        this.menuView = this.container.querySelector('.lumi-menu-view');
        this.grid = this.container.querySelector('.lumi-grid');
        this.pagination = this.container.querySelector('.lumi-pagination');
        this.searchInput = this.container.querySelector('.lumi-search');
        this.sourceSelect = this.container.querySelector('.lumi-source-select');
        this.gameCount = this.container.querySelector('.lumi-count');

        this.gameView = this.container.querySelector('.lumi-game-view');
        this.iframe = this.container.querySelector('.lumi-iframe');
        this.backBtn = this.container.querySelector('.lumi-back-btn');
        this.fullscreenBtn = this.container.querySelector('.lumi-fullscreen-btn');

        this.searchInput.addEventListener('input', (e) => {
            this.currentSearch = e.target.value;
            this.applyFilters();
        });

        this.sourceSelect.addEventListener('change', (e) => {
            this.currentSource = e.target.value;
            this.applyFilters();
        });

        this.backBtn.addEventListener('click', () => this.closeGame());


        this.fullscreenBtn.addEventListener('click', () => {
            if (this.gameView.requestFullscreen) {
                this.gameView.requestFullscreen();
            } else if (this.gameView.webkitRequestFullscreen) {
                this.gameView.webkitRequestFullscreen();
            } else if (this.iframe.requestFullscreen) {
                this.iframe.requestFullscreen();
            }
        });
    }

    cleanPath(path) {
        if (!path) return '';
        return path
            .replace(/%7BHTML_URL%7D\//gi, '')
            .replace(/{HTML_URL}\//gi, '')
            .replace(/%7BCOVER_URL%7D\//gi, '')
            .replace(/^\//, '');
    }

    async ensureLuminReady() {
        if (this._luminReady) return;
        if (this._luminInitPromise) return this._luminInitPromise;
        this._luminInitPromise = (async () => {
        if (window.TR_OS_LUMIN_READY) await this.withDeadline(window.TR_OS_LUMIN_READY, 20000, 'Lumin SDK timeout');
        if (!window.Lumin || window.Lumin === this) throw new Error("Lumin SDK not loaded");
        if (typeof window.Lumin.init === 'function') {
            const initP = (async () => {
                try {
                    await window.Lumin.init({ headless: true });
                } catch {
                    await new Promise((resolve, reject) => {
                        window.Lumin.init({ headless: true, onReady: resolve, onError: reject });
                    });
                }
            })();
            await this.withDeadline(initP, 20000, 'Lumin init timeout');
        }
        this._luminProvider = window.Lumin;
        this._luminReady = true;
        })().catch(error => { this._luminInitPromise = null; throw error; });
        return this._luminInitPromise;
    }

    async withDeadline(promise, milliseconds, message) {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
        finally { clearTimeout(timer); }
    }

    async resolveLuminUrl(id) {
        if (LumiSDK.urlCache.has(id)) return LumiSDK.urlCache.get(id);
        try { await this.ensureLuminReady(); } catch { return null; }
        try {
            if (typeof this._luminProvider.getGameUrl === 'function') {
                const r = await this._luminProvider.getGameUrl(id);
                const out = (typeof r === 'string') ? r : (r && r.url) || null;
                if (out) {
                    LumiSDK.urlCache.set(id, out);
                    if (LumiSDK.urlCache.size > 120) {
                        LumiSDK.urlCache.delete(LumiSDK.urlCache.keys().next().value);
                    }
                    return out;
                }
            }
        } catch {}
        return null;
    }

    prefetchVisible() {
        try {
            if (document.hidden || this._prefetchPending) return;
            this._prefetchPending = true;
            const idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 800); };
            idle(() => {
                this._prefetchPending = false;
                try {
                    const cards = this.grid ? this.grid.querySelectorAll('.lumi-game-card') : [];
                    let n = 0;
                    for (const card of cards) {
                        if (n >= 3) break;
                        const game = card._game;
                        if (game && !game._html && !game._warming) {
                            n++;
                            this.warmGame(game);
                        }
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }

    async loadGames() {
        const sources = Array.from({ length: 6 }, () => []);
        const fetchJSON = async (url) => {
            try {
                return await (await fetch(url)).json();
            } catch (e) {
                return [];
            }
        };
        const publish = () => {
            this.games = sources.flat()
                .filter(game => game.url && game.title)
                .sort((a, b) => (b.source === "Lumin") - (a.source === "Lumin"));
            this.applyFilters(false);
        };
        await Promise.allSettled([
        (async () => {
        const loadedGames = sources[0];
        try {
            const iconMap = {};
            const files = fetchJSON('https://api.github.com/repos/carbonicality/ChickenKingsVault/contents/gamefiles/');
            try {
                const iconRes = await fetch(`${CKV_ICONS_URL}/games.json`);
                const iconJson = await iconRes.json();
                iconJson.forEach(g => {
                    const key = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    iconMap[key] = `${CKV_ICONS_URL}/gameimages/${g.img}`;
                });
            } catch (e) {}

            const json = await files;
            let htmlFiles = json.filter(f => f.type === 'file' && f.name.endsWith('.html') && f.name !== 'index-2.html');
            const prettyFiles = htmlFiles.filter(f => /[A-Z\s]/.test(f.name));
            if (prettyFiles.length > 0) htmlFiles = prettyFiles;
            
            htmlFiles.forEach(f => {
                const normKey = f.name.replace('.html', '').toLowerCase().replace(/[^a-z0-9]/g, '');
                loadedGames.push({
                    title: f.name.replace('.html', ''),
                    cover: iconMap[normKey] || FALLBACK_IMAGE,
                    url: `${CKV_URL}/gamefiles/${f.name}`,
                    source: "CKV"
                });
            });
        } catch (e) {
            console.error('Failed CKV fetch:', e);
        }
        publish();
        })(),
        (async () => {
        const loadedGames = sources[1];
        const gnmathData = await fetchJSON(GNMATH_API);
        gnmathData.forEach(g => {
            const cleanUrlParam = this.cleanPath(g.url);
            const gameUrl = cleanUrlParam.includes('.') ? `${GNMATH_HTML}/${cleanUrlParam}` : `${GNMATH_HTML}/${cleanUrlParam}/index.html`;

            loadedGames.push({
                title: g.title || g.name,
                cover: g.cover ? `${GNMATH_COVER}/${this.cleanPath(g.cover)}` : FALLBACK_IMAGE,
                url: gameUrl,
                source: "GNMath"
            });
        });
        publish();
        })(),
        (async () => {
        const loadedGames = sources[2];
        const ugsData = await fetchJSON(UGS_API);
        ugsData.forEach(g => {
            let ugsHtmlBase = UGS_HTML_URL1;
            let rawUrl = g.url || "";

            if (rawUrl.includes("{HTML_URL2}") || g.repo === 'ugs-2') {
                ugsHtmlBase = UGS_HTML_URL2;
            } else if (rawUrl.includes("{HTML_URL3}") || g.repo === 'ugs-3') {
                ugsHtmlBase = UGS_HTML_URL3;
            }

            let finalCover = g.cover || g.image || "";
            finalCover = finalCover.replace(/{COVER_URL}/g, UGS_HTML_URL1.replace('/ugs-1@main', '/ugs-covers@main'));
            if (!finalCover.startsWith('http')) {
                finalCover = `${UGS_HTML_URL1}/${this.cleanPath(finalCover)}`;
            }

            let finalUrl = rawUrl
                .replace(/{HTML_URL1}/g, UGS_HTML_URL1)
                .replace(/{HTML_URL2}/g, UGS_HTML_URL2)
                .replace(/{HTML_URL3}/g, UGS_HTML_URL3);

            if (!finalUrl.startsWith('http')) {
                finalUrl = `${ugsHtmlBase}/${this.cleanPath(finalUrl)}`;
            }

            loadedGames.push({
                title: g.title || g.name,
                cover: finalCover || FALLBACK_IMAGE,
                url: finalUrl,
                source: "UGS"
            });
        });
        publish();
        })(),
        (async () => {
        const loadedGames = sources[3];
        const daknuxData = await fetchJSON(DAKNUX_API);
        daknuxData.forEach(g => {
            const cleanUrlParam = this.cleanPath(g.url);
            const gameUrl = cleanUrlParam.includes('.') ? `${DAKNUX_HTML}/${cleanUrlParam}/index.html` : `${DAKNUX_HTML}/${cleanUrlParam}/index.html`;

            loadedGames.push({
                title: g.title || g.name,
                cover: g.cover ? `${DAKNUX_COVER}/${this.cleanPath(g.cover)}` : FALLBACK_IMAGE,
                url: gameUrl,
                source: "Daknux"
            });
        });
        publish();
        })(),
        (async () => {
        const loadedGames = sources[4];
        const nebulaData = await fetchJSON(NEBULA_API);
        const nebulaGames = Array.isArray(nebulaData) ? nebulaData : (nebulaData.games || []);
        nebulaGames.forEach(g => {
            const file = g.file || "";
            if (!file) return;
            loadedGames.push({
                title: g.name || g.slug || "Unknown Game",
                cover: FALLBACK_IMAGE,
                url: `${NEBULA_BASE}/${file}`,
                source: "Nebula"
            });
        });
        publish();
        })(),
        (async () => {
        const loadedGames = sources[5];
        try {
            await this.ensureLuminReady();
            const luminResult = await this.withDeadline(this._luminProvider.getGames({ page: 1, limit: 999 }), 25000, 'Lumin timeout');
            const mapPage = result => (result.games || result || []).map(g => ({
                    title: g.name || g.title || "Unknown Game",
                    cover: FALLBACK_IMAGE,
                    url: g.id,
                    source: "Lumin",
                    image_token: g.image_token || ""
                }));
            const pages = [mapPage(luminResult)];
            const publishLumin = () => {
                loadedGames.length = 0;
                for(const game of pages.flat())loadedGames.push(game);
                publish();
            };
            publishLumin();
            const pageCount = Number.isSafeInteger(luminResult.pages) ? luminResult.pages : 1;
            let nextPage = 2;
            await Promise.all(Array.from({ length: Math.min(4, Math.max(0, pageCount - 1)) }, async () => {
                while (nextPage <= pageCount) {
                    const page = nextPage++;
                    try {
                        const result = await this.withDeadline(this._luminProvider.getGames({ page, limit: 999 }), 25000, 'Lumin timeout');
                        pages[page - 1] = mapPage(result);
                        publishLumin();
                    } catch {}
                }
            }));
        } catch (e) {
            console.error('Failed Lumin fetch:', e);
        }
        })()
        ]);
    }

    applyFilters(resetPage = true) {
        const lowerQuery = this.currentSearch.toLowerCase();

        this.filteredGames = this.games.filter(game => {
            const matchesSearch = game.title.toLowerCase().includes(lowerQuery);
            const matchesSource = this.currentSource === "All" || game.source === this.currentSource;
            return matchesSearch && matchesSource;
        });

        this.currentPage = resetPage ? 1 : Math.min(this.currentPage, Math.max(1, Math.ceil(this.filteredGames.length / this.config.gamesPerPage)));
        this.updateView();
    }

    queueCover(game, card) {
        if (game.source !== 'Lumin' || !game.image_token || game.cover !== FALLBACK_IMAGE) return;
        game._coverCards ||= new Set();
        game._coverCards.add(card);
        if (!game._coverPromise) {
            this._coverQueue ||= [];
            game._coverPromise = new Promise(resolve => this._coverQueue.push({ game, resolve }));
            this.drainCovers();
        }
        game._coverPromise.then(() => {
            if (!card.isConnected || game.cover === FALLBACK_IMAGE) return;
            const placeholder = card.querySelector('.lumi-noimg');
            if (!placeholder) return;
            const image = document.createElement('img');
            image.src = game.cover; image.alt = game.title; image.className = 'lumi-game-img'; image.loading = 'lazy'; image.decoding = 'async';
            image.onerror = () => { image.src = FALLBACK_IMAGE; image.onerror = null; };
            placeholder.replaceWith(image);
        });
    }

    drainCovers() {
        this._activeCovers ||= 0;
        while (this._activeCovers < 6 && this._coverQueue?.length) {
            const { game, resolve } = this._coverQueue.shift();
            if (![...game._coverCards].some(card => card.isConnected)) {
                game._coverPromise = null; game._coverCards = null; resolve(); continue;
            }
            this._activeCovers++;
            (async () => {
                try {
                    const cover = await this._luminProvider.getImageUrl(game.image_token);
                    if (cover) game.cover = cover;
                } catch {} finally {
                    this._activeCovers--; game._coverCards = null; resolve();
                    if (game.cover === FALLBACK_IMAGE) game._coverPromise = null;
                    this.drainCovers();
                }
            })();
        }
    }

    renderGrid() {
        if (!this.grid) return;
        this.grid.innerHTML = '';
        const start = (this.currentPage - 1) * this.config.gamesPerPage;
        const pageGames = this.filteredGames.slice(start, start + this.config.gamesPerPage);

        const fragment = document.createDocumentFragment();
        pageGames.forEach(game => {
            const card = document.createElement('div');
            card.className = 'lumi-game-card';
            const hasCover = game.cover && game.cover !== FALLBACK_IMAGE;
            card.innerHTML = `
                <span class="lumi-badge">${game.source}</span>
                ${hasCover ? `<img src="${game.cover}" alt="${game.title}" class="lumi-game-img" loading="lazy" onerror="this.src='${FALLBACK_IMAGE}'">` : `<div class="lumi-noimg">${game.title}</div>`}
                <div class="lumi-game-title-overlay">${game.title}</div>
            `;
            card._game = game;
            card.onclick = () => this.playGame(game);
            card.addEventListener("mouseenter", () => this.warmGame(game), { once: true });
            card.addEventListener("pointerdown", () => this.warmGame(game), { once: true });
            fragment.appendChild(card);
        });

        this.grid.appendChild(fragment);
        for (const card of this.grid.children) this.queueCover(card._game, card);
        this.prefetchVisible();
    }

    renderPagination() {
        if (!this.pagination) return;
        this.pagination.innerHTML = '';
        const totalPages = Math.ceil(this.filteredGames.length / this.config.gamesPerPage);
        if (totalPages <= 1) return;

        const fragment = document.createDocumentFragment();

        const createBtn = (text, page, isActive = false) => {
            const btn = document.createElement('button');
            btn.className = `lumi-page-btn ${isActive ? 'active' : ''}`;
            btn.innerText = text;
            btn.onclick = () => {
                this.currentPage = page;
                this.updateView();
            };
            fragment.appendChild(btn);
        };

        if (this.currentPage > 1) createBtn('Prev', this.currentPage - 1);

        let startPage = Math.max(1, this.currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            createBtn(i, i, i === this.currentPage);
        }

        if (this.currentPage < totalPages) createBtn('Next', this.currentPage + 1);

        this.pagination.appendChild(fragment);
    }

    updateView() {
        if (this.gameCount) this.gameCount.textContent = !this.games.length && !this.loaded ? 'Laddar spel…' : `${this.games.length} games`;
        this.renderGrid();
        this.renderPagination();
    }

    async playGame(game) {
        if (!game || !game.url) return;
        const now = Date.now();
        if (this._lastOpen && this._lastOpen.url === game.url && now - this._lastOpen.t < 1500) return;
        this._lastOpen = { url: game.url, t: now };
        this.loadGame(this._gameId(game, this.games.indexOf(game)));
    }

    downloadGame() {
        if (!this.currentGameHtml) {
            alert("This game cannot be downloaded directly (cross-origin restrictions or no source provided).");
            return;
        }

        const blob = new Blob([this.currentGameHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const cleanTitle = this.currentGameTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        a.download = `${cleanTitle}.html`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    closeGame() {
        this._playRequest = (this._playRequest || 0) + 1;
        this.gameView.style.display = 'none';
        this.menuView.style.display = 'flex';
        this.iframe.removeAttribute('srcdoc');
        this.iframe.src = '';
        this.currentGameUrl = "";
        this.currentGameHtml = "";
        this.currentGameTitle = "game";
    }
}

// The upstream loader owns window.Lumin (including its async bootstrap setter).
// Keep our combined catalog separate so neither API can overwrite the other.
window.TR_OS_GAMES = new LumiSDK();
