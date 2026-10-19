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

Importera detta GitHub-repo i ditt Vercel-team. `vercel.json` väljer Other, bygger frontendfiler till `public/` och skickar serveranrop till `api/index.js`. Även startsidan och HTML-sidorna går via servern så att medlemskapsspärren används. API-funktionen exporterar samma HTTP-server som den lokala versionen, inklusive WebSocket-uppgraderingar. Miljöfil, serverkod, tester och dependencies kopieras inte till den publika katalogen. `/tr-os.config.js` genereras av servern.

Välj projektets Settings → Domains för att koppla din domän efter en lyckad driftsättning. Använd DNS-värdena som Vercel visar för just domänen. Leverantörernas API-nycklar läggs i Vercels Environment Variables, aldrig i frontend.

Vercel-funktioner kan startas om och köras i flera instanser. Nuvarande chatt/presens använder minne och behöver delad lagring för pålitlig produktion med flera användare. WebSocket-klienter kan behöva återansluta vid funktionens tidsgräns. VPN, AI och molnspel kräver fortfarande att respektive anslutna tjänst är tillgänglig och har giltig åtkomst. Vercel-publicering tar inte bort dessa krav.

Lokal AI: TR-os lokal AI kör SmolLM2 360M med WebLLM på besökarens WebGPU. Modellfiler hämtas vid första meddelandet och cachelagras av WebLLM. Kräver några hundra MB nedladdning och cirka 580 MB GPU-minne. Det är ingen Duck.ai-API-integration. Serveralternativen kräver fortfarande AI_URL/AI_KEY/AI_MODEL. Cloud gaming kräver egna spelservrar; katalogen är ingen spelserver.




## Supportchatt, push och driftlarm

Spärrade webbläsare kan skriva till admin. Samtalet ligger kvar efter att spärren hävts och fortsätter på `/support.html`. Admin svar och nya användarmeddelanden uppdateras i panelen och skickar push om mottagaren har aktiverat det på sin enhet. Nya spärrar och felrapporter skickar också push till adminenheter.

Tryck **Aktivera push** i adminpanelen på varje enhet som ska få notiser. På iPhone måste TR-os först läggas på hemskärmen och öppnas som app. Användaren kan aktivera avisering för adminsvar i supportchatten. Prenumerationer och en VAPID-nyckel lagras på servern i Redis; den privata nyckeln skickas aldrig till klienten. Notiser kan inte tas emot om användaren nekat systemnotiser, saknar nätanslutning eller om operativsystemet stoppar bakgrundsaviseringar.

En extern GitHub Actions-kontroll kör var femte minut. Vid driftstopp öppnar den ett issue i GitHub och stänger det när TR-os svarar igen. Det kräver att GitHub Actions är aktiverat. Mobilaviseringar för detta driftlarm styrs av GitHubs egna repo- och appnotisinställningar; en server som ligger nere kan inte skicka sina egna pushnotiser.

## Medlemskap och Swish

TR-os kräver ett konto för hemsidans sidor och API. Nya konton får tre dagars provperiod. Standardabonnemanget kostar 40 kr den första betalda månaden, 35 kr den andra och 30 kr per månad från den tredje månaden. Varje betalning ger 30 dagars åtkomst. Kontot kan vara inloggat på en dator och en mobil. `/account.html` används för att skapa konto, logga in och förnya.

Medlemmen får ett belopp och en unik referens att skriva som Swishmeddelande. När betalningen har skickats fyller medlemmen i betalarens för- och efternamn och anmäler den. Admin jämför anmälan med Swish och godkänner den manuellt; först då förlängs medlemskapet. Admin får en notis när en betalning anmäls och kan se betalaren, kontonamnet, beloppet, referensen och betalningshistoriken.

I adminpanelen kan du ändra abonnemangsnamn och priser, skapa medlemskonton, ändra namn och slutdatum, pausa konton, byta lösenord och återställa enhetsinloggningar. Du kan lägga till dagar och timmar på en medlem eller ge extra tid till alla aktiva konton vars åtkomst gått ut. Pushnotiser kräver att admin har aktiverat notiser i webbläsaren.

`SWISH_NUMBER` är numret som visas för betalningen och kan ändras i värdens miljövariabler. Det är förifyllt med numret som administratören har angett. Medlemskonton och betalningar sparas i den konfigurerade Upstash Redis-databasen. Lägg in `UPSTASH_REDIS_REST_URL` och `UPSTASH_REDIS_REST_TOKEN` bland värdens hemliga miljövariabler. Lösenord lagras som scrypt-hashar; sessionscookies är HttpOnly.

## Gemensam besöksräkning

Närvaro lagras i Upstash Redis via serverns KV_REST_API_URL och KV_REST_API_TOKEN (eller UPSTASH_REDIS_REST_URL/TOKEN). Webbläsaren skickar ett anonymt ID var 30:e sekund. Redis räknar gemensamt över alla instanser: aktiva under 90 sekunder och unika webbläsare under ett rullande 30-minutersfönster. Flera flikar delar ID. Närvaronycklarna sparar bara en hash av ID och senaste tidsstämpeln, inga IP-adresser. Gamla poster rensas och nyckeln löper ut efter en timme utan livssignaler. Vid databasfel visas okänt, inte falskt noll eller lokala sessionsantal.

Adminens servervärden gäller fortfarande den aktuella serverinstansen. Chattmeddelanden och sessionsautentisering använder befintlig serverlagring och omfattas inte av närvarodatabasen. Production har databasanslutning; Preview delar inte besöksdata.


### Snapchat compatibility view
The Snapchat shortcut uses `snapchat.html` with a separate Scramjet 2.0.67-alpha.2 controller (0.0.14) and Epoxy transport 3.0.1. The existing Scramjet/bare-mux proxy remains in place for other pages. The worker dispatches only the new controller's registered `/snap-proxy/` requests to that controller. See `snapchat-notices.html` for upstream source/license information.

App startup and its automatic redirect to Snapchat Web's account login were verified. Account login, security verification and private chat still require user testing; this integration does not bypass Snapchat authentication or security checks.

### Hosted Snapchat experiment removed
The rejected Browserbase test flow is disabled. Its former page redirects to the TR-os home page, the admin navigation entry is removed, and all hosted Snapchat API endpoints return HTTP 410 without loading the provider module or using credentials. The normal Snapchat shortcut remains inside TR-os; full account login and private chat are not verified. Previously created provider profiles are not automatically deleted.
