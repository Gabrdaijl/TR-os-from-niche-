// TR-os proxy assets v4: absolute client paths on every frame.
/************************
 * swium dev
 * (literally first dev realize, most of the features arent here)
 * | by VAPOR/created by s16dih
 ***********************/

/*
Examples:
const CONFIG = {
	blocked: [
		".doubleclick.net", ".googlesyndication.com", ".googleadservices.com",
		".adsterra.com", ".popads.net", ".popcash.net", ".highperformanceformat.com",
		".profitablecpmrate.com", ".profitableratecpm.com", ".effectivegatecpm.com",
		block a domain
		"example.com",
    subdomains
		"*.example.com",           blocks any subdomain (a.example.com, foo.bar.example.com, etc.)
		"tracker.*.example.com",   blocks tracker.us.example.com, tracker.eu.example.com, etc.
    paths
		"example.com/ads",         blocks only https://example.com/ads
		"example.com/ads/*",       blocks any path under /ads
		"example.com/*.js",        blocks all JS files at root (e.g., /app.js)
		"example.com/assets/*.png",  blocks only PNG files inside /assets
    double wildcards
		"example.com/**",          blocks *all* paths on example.com
    weird cases
		"*.example.com/**.gif",    blocks all .gif files on any subdomain
		"example.com/",            blocks only the main page
		"example.com/*",           blocks one level deep paths
	],
};
when ur done doing it you have to base64d it before putting it there this is for fi*ters
*/
/************************
 * swium dev
 * (literally first dev realize, most of the features arent here)
 * | by VAPOR/created by s16dih
 ***********************/

if (navigator.userAgent.includes("Firefox")) {
	try {
		Object.defineProperty(globalThis, "crossOriginIsolated", {
			value: true,
			writable: false,
		});
	} catch (e) {}
}

importScripts("scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
let proxyConfigReady;

const CONFIG = {
	blocked: [
        ".doubleclick.net", ".googlesyndication.com", ".googleadservices.com",
        ".adsterra.com", ".popads.net", ".popcash.net", ".highperformanceformat.com",
        ".profitablecpmrate.com", ".profitableratecpm.com", ".effectivegatecpm.com",
		"youtube.com/get_video_info?*adformat=*",
		"youtube.com/api/stats/ads/*",
		"youtube.com/pagead/*",
		".facebook.com/ads/*",
		".facebook.com/tr/*",
		".fbcdn.net/ads/*",
		"graph.facebook.com/ads/*",
		"ads-api.twitter.com/*",
		"analytics.twitter.com/*",
		".twitter.com/i/ads/*",
		".ads.yahoo.com",
		".advertising.com",
		".adtechus.com",
		".oath.com",
		".verizonmedia.com",
		".amazon-adsystem.com",
		"aax.amazon-adsystem.com/*",
		"c.amazon-adsystem.com/*",
		".adnxs.com",
		".adnxs-simple.com",
		"ab.adnxs.com/*",
		".rubiconproject.com",
		".magnite.com",
		".pubmatic.com",
		"ads.pubmatic.com/*",
		".criteo.com",
		"bidder.criteo.com/*",
		"static.criteo.net/*",
		".openx.net",
		".openx.com",
		".indexexchange.com",
		".casalemedia.com",
		".adcolony.com",
		".chartboost.com",
		".unityads.unity3d.com",
		".inmobiweb.com",
		".tapjoy.com",
		".applovin.com",
		".vungle.com",
		".ironsrc.com",
		".fyber.com",
		".smaato.net",
		".supersoniads.com",
		".startappservice.com",
		".airpush.com",
		".outbrain.com",
		".taboola.com",
		".revcontent.com",
		".zedo.com",
		".mgid.com",
		"*/ads/*",
		"*/adserver/*",
		"*/adclick/*",
		"*/banner_ads/*",
		"*/sponsored/*",
		"*/promotions/*",
		"*/tracking/ads/*",
		"*/promo/*",
		"*/affiliates/*",
		"*/partnerads/*",
	],
	inject: {
		html: "\x3c!-- pr0x1ed by vapor's static sj --\x3e",
	},
};

/** @type {{ origin: string, html: string, css: string, js: string } | undefined} */
let playgroundData;

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function toRegex(pattern) {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "{{DOUBLE_STAR}}")
		.replace(/\*/g, "[^/]*")
		.replace(/{{DOUBLE_STAR}}/g, ".*");
	return new RegExp(`^${escaped}$`);
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {boolean}
 */
function isBlocked(hostname, pathname) {
  return CONFIG.blocked.some(pattern => {
    pattern = pattern.replace(/^#/, '');
    const slash = pattern.indexOf('/');
    const host = slash < 0 ? pattern : pattern.slice(0, slash);
    const path = slash < 0 ? null : pattern.slice(slash);
    const matchesHost = host === '*' || (host.startsWith('.')
      ? hostname === host.slice(1) || hostname.endsWith(host)
      : toRegex(host).test(hostname));
    return matchesHost && (!path || toRegex(path).test(pathname));
  });
}

/**
 * @param {string} html
 * @returns {string}
 */
function inject(html) {
	return html.replace(/<head[^>]*>/i, (match) => `${match}${CONFIG.inject.html}`);
}

/**
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function handleRequest(event) {
  try {
    const url = new URL(event.request.url);
    // App pages and assets must never wait for proxy configuration. On a
    // repeat visit the worker can run before the controller initializes it.
    const proxyPrefix = new URL("scramjet/", self.registration.scope).pathname;
    if (url.origin !== self.location.origin || !url.pathname.startsWith(proxyPrefix)) {
      return fetch(event.request);
    }
  } catch {}

  try {
    let configTimer;
    try {
      if (!proxyConfigReady) {
        // A controller message can set the instance config before the worker
        // has initialized the shared rewriter/WASM configuration. Load both
        // from the same IndexedDB record once before serving proxy traffic.
        scramjet.config = undefined;
        proxyConfigReady = scramjet.loadConfig().then(() => {
          if (!scramjet.config) throw new Error('Proxy configuration is missing');
        });
      }
      await Promise.race([
        proxyConfigReady,
        new Promise((_, reject) => {
          configTimer = setTimeout(() => reject(new Error("Proxy initialization timed out")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(configTimer);
    }
  } catch {
    proxyConfigReady = null;
    return new Response("Proxy is not ready. Open the TR-os home page and try again.", { status: 503 });
  }

  try {
    if (scramjet.route(event)) {
      const response = await scramjet.fetch(event);
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/html")) {
        const originalText = await response.text();
        const modifiedHtml = inject(originalText);
        const encoder = new TextEncoder();
        const byteLength = encoder.encode(modifiedHtml).length;
        const newHeaders = new Headers(response.headers);
        newHeaders.set("content-length", byteLength.toString());

        return new Response(modifiedHtml, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }

      return response;
    }
  } catch (e) {
    console.error('TR-os proxy request failed:', e);
    self.clients.matchAll().then(clients => {
      for (const client of clients) client.postMessage({ type: 'tr-os-proxy-error', message: String(e && e.message || e) });
    }).catch(() => {});
    return new Response('This page could not be loaded through TR-os. Please try again.', { status: 502 });
  }

  try {
    return await fetch(event.request);
  } catch (e) {
    return new Response("Service worker fetch failed", { status: 502 });
  }
}

self.addEventListener("install", () => {
  try { self.skipWaiting(); } catch {}
});

self.addEventListener("activate", (event) => {
  try { event.waitUntil(self.clients.claim()); } catch {}
});

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});

self.addEventListener("message", ({ data }) => {
	if (data.type === "playgroundData") {
		playgroundData = data;
	}
});

scramjet.addEventListener("request", (e) => {
	if (isBlocked(e.url.hostname, e.url.pathname)) {
		e.response = new Response("Site Blocked", { status: 403 });
		return;
	}

	if (playgroundData && e.url.href.startsWith(playgroundData.origin)) {
		const routes = {
			"/": { content: playgroundData.html, type: "text/html" },
			"/style.css": { content: playgroundData.css, type: "text/css" },
			"/script.js": { content: playgroundData.js, type: "application/javascript" },
		};

		const route = routes[e.url.pathname];

		if (route) {
			let content = route.content;

			if (route.type === "text/html") {
				content = inject(content);
			}

			const headers = { "content-type": route.type };
			e.response = new Response(content, { headers });
			e.response.rawHeaders = headers;
			e.response.rawResponse = {
				body: e.response.body,
				headers: headers,
				status: e.response.status,
				statusText: e.response.statusText,
			};
			e.response.finalURL = e.url.toString();
		} else {
			e.response = new Response("empty response", { headers: {} });
		}
	}
});
