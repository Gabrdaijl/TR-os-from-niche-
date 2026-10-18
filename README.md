# TR-os

TR-os med egen Node-server för webbproxy, online-status, gruppchatt och privata meddelanden. Frontend, teman, spelkatalog och filmkatalog ingår.

## Starta

Använd Node.js 22.12 eller senare.

```sh
npm ci
npm start
```

Öppna `http://localhost:8173/index.html`. Kör `npm test` för serverns integrationstester. Chatt och online-sessioner hålls i minnet och nollställs när servern startas om.

## Publicera på en server

GitHub lagrar koden; GitHub Pages kan inte köra Node-backenden. Kör `npm start` på en Node-kompatibel host eller bygg den medföljande Dockerfilen. Sätt `HOST=0.0.0.0` på en host som kräver det, använd HTTPS och vidarebefordra WebSocket-uppgraderingar i reverse proxyn. Frontend, service worker och backend ska ligga på samma domän.

Servern blockerar åtkomst till serverkod, miljöfiler och paketmappar. Med PROXY_PROVIDER=direct tillåter den lokala direktproxyn webbportarna 80 och 443; privata och lokala IP-adresser blockeras.

## AI, VPN och molnspel

Kopiera `.env.example` till `.env` lokalt och fyll i de tjänster du äger. Miljöfilen ska aldrig läggas på GitHub.

- AI: ange `AI_URL` till en OpenAI-kompatibel chat-completions-endpoint, `AI_KEY` och eventuellt `AI_MODEL`. Alternativt används en lokal Ollama-server på `OLLAMA_URL` med modellen `OLLAMA_MODEL`; Ollama och modellen måste redan finnas och vara startade. Inga AI-svar simuleras.
- Proxy: standardläget PROXY_PROVIDER=direct använder TR-os egen Wisp-server. Ingen extern proxytjänst behövs. Detta är en webbproxy, ingen VPN-tunnel. En riktig VPN kräver egen VPN-server och konfigurerade VPN_API_URL/VPN_WISP_URL. Det gamla reference-läget är valbart men används inte som standard.
- Molnspel: referensläget ansluter samma `/cloud/v1/*`-API hos t9os.space; det kräver att tjänsten är tillgänglig och att en giltig åtkomstnyckel finns. Ange annars `CLOUD_API_URL` till en egen tjänst som implementerar frontendens `/cloud/v1/*`-kontrakt. `CLOUD_API_KEY` kan hållas på servern. En giltig leverantör och spelrättigheter krävs.
- Cheats: `JOIN_URL` anger den spel-/undervisningstjänst som knappen ska öppna. Spelvalen öppnar officiella anslutningssidor. Inga cheats för Gimkit, Kahoot eller Blooket ingår.
- Filmmetadata: `TMDB_API_KEY` kan sättas på servern. Filmplanschernas proxy följer samma API-bas som övriga anrop.

Detta är en självständig implementation för TR-os, inte referenssidans privata serverkod. Frontendens flöden bevaras, men tillgång till privata VPN-, AI- och molnspelstjänster ingår inte automatiskt.

## Bibliotek

Proxybiblioteken och deras licensnotiser finns kvar i källkoden. Serverns Wisp-implementation kommer från [MercuryWorkshop/wisp-js](https://github.com/MercuryWorkshop/wisp-js) och installeras som en separat npm-dependency. Lokala AI-anrop använder [Ollamas chat-API](https://docs.ollama.com/api/chat).

Den speglade Scramjet-filen är korrigerad på två ställen: service workerns IndexedDB-namn återställs från `%24scramjet.html` till `$scramjet`, samma namn som klienten använder. Även klientens modulgrupper (./dom/, ./worker/, ./shared/) och absoluta biblioteksadresser har återställts. Övriga tredjepartsnotiser behålls.

Sätt miljövariabeln `TR_OS_NETWORK_TEST=1` vid testkörning för det extra testet av en riktig utgående Wisp-ström. Övriga tester kräver ingen extern AI- eller molnspelsleverantör.

Spelens HTML filtreras före start och får ett annonsfilter för kända annonsdomäner och popupfönster. Korsdomänsramar kan begränsa filtret. Filmspelaren erbjuder VidFast, VidLink och VidSrc; upptäckta proxyfelsidor växlar till nästa källa. Tredjepartskällors innehåll/tillgänglighet kan inte garanteras.

## Cloud launcher

Cloud-sidan öppnar den externa launchern direkt utan startsida, spelkatalog eller API-nyckelfält. Fullskärmsknappen använder webbläsarens Fullscreen API och huvudramen tillåter fullskärm. Den externa tjänsten bestämmer spelåtkomst och köer; inga privata nycklar kopieras.

## Vercel

Importera detta GitHub-repo i ditt Vercel-team. `vercel.json` väljer Other, bygger frontendfiler till `public/` och skickar serveranrop till `api/index.js`. API-funktionen exporterar samma HTTP-server som den lokala versionen, inklusive WebSocket-uppgraderingar. Miljöfil, serverkod, tester och dependencies kopieras inte till den publika katalogen. `/tr-os.config.js` genereras av servern.

Välj projektets Settings → Domains för att koppla din domän efter en lyckad driftsättning. Använd DNS-värdena som Vercel visar för just domänen. Leverantörernas API-nycklar läggs i Vercels Environment Variables, aldrig i frontend.

Vercel-funktioner kan startas om och köras i flera instanser. Nuvarande chatt/presens använder minne och behöver delad lagring för pålitlig produktion med flera användare. WebSocket-klienter kan behöva återansluta vid funktionens tidsgräns. VPN, AI och molnspel kräver fortfarande att respektive anslutna tjänst är tillgänglig och har giltig åtkomst. Vercel-publicering tar inte bort dessa krav.

Lokal AI: TR-os lokal AI kör SmolLM2 360M med WebLLM på besökarens WebGPU. Modellfiler hämtas vid första meddelandet och cachelagras av WebLLM. Kräver några hundra MB nedladdning och cirka 580 MB GPU-minne. Det är ingen Duck.ai-API-integration. Serveralternativen kräver fortfarande AI_URL/AI_KEY/AI_MODEL. Cloud gaming kräver egna spelservrar; katalogen är ingen spelserver.




## Gemensam besöksräkning

Närvaro lagras i Upstash Redis via serverns KV_REST_API_URL och KV_REST_API_TOKEN (eller UPSTASH_REDIS_REST_URL/TOKEN). Webbläsaren skickar ett anonymt ID var 30:e sekund. Redis räknar gemensamt över alla instanser: aktiva under 90 sekunder och unika webbläsare under ett rullande 30-minutersfönster. Flera flikar delar ID. Databasen sparar bara en hash av ID och senaste tidsstämpeln, inga IP-adresser eller chattmeddelanden. Gamla poster rensas och nyckeln löper ut efter en timme utan livssignaler. Vid databasfel visas okänt, inte falskt noll eller lokala sessionsantal.

Adminens servervärden gäller fortfarande den aktuella serverinstansen. Chattmeddelanden och sessionsautentisering använder befintlig serverlagring och omfattas inte av närvarodatabasen. Production har databasanslutning; Preview delar inte besöksdata.


### Snapchat compatibility view
The Snapchat shortcut uses `snapchat.html` with a separate Scramjet 2.0.67-alpha.2 controller (0.0.14) and Epoxy transport 3.0.1. The existing Scramjet/bare-mux proxy remains in place for other pages. The worker dispatches only the new controller's registered `/snap-proxy/` requests to that controller. See `snapchat-notices.html` for upstream source/license information.

App startup and its automatic redirect to Snapchat Web's account login were verified. Account login, security verification and private chat still require user testing; this integration does not bypass Snapchat authentication or security checks.

### Hosted Snapchat experiment
`snapchat-test.html` is an administrator-only Browserbase experiment, linked from the admin panel. The production Marketplace resource uses the Free plan (one concurrent browser and one browser-hour). `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` remain sensitive server environment variables. The endpoint also requires the existing Redis REST configuration and admin password. Public Snapchat/proxy behavior is retained while private-chat compatibility is tested.

Each test holds its own CDP connection through a streamed HTTP response, lasts at most 240 seconds, and releases the remote session on stop/disconnect/timeout. Recording, session logging, CAPTCHA solving and advanced stealth are disabled. The application never reads Snapchat credentials or messages. A Redis lock prevents overlapping tests across server instances; a non-expiring budget reserves at most ten starts for this project (including failed starts). Do not reset that budget or enable paid features without a separate plan review. The short duration follows the existing Vercel function limit; this is not an unlimited public cloud browser.
