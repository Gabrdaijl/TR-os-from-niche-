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

Servern blockerar åtkomst till serverkod, miljöfiler och paketmappar. Direkt proxy tillåter webbportarna 80 och 443; privata och lokala IP-adresser blockeras.

## AI, VPN och molnspel

Kopiera `.env.example` till `.env` lokalt och fyll i de tjänster du äger. Miljöfilen ska aldrig läggas på GitHub.

- AI: ange `AI_URL` till en OpenAI-kompatibel chat-completions-endpoint, `AI_KEY` och eventuellt `AI_MODEL`. Alternativt används en lokal Ollama-server på `OLLAMA_URL` med modellen `OLLAMA_MODEL`; Ollama och modellen måste redan finnas och vara startade. Inga AI-svar simuleras.
- VPN: ange `VPN_API_URL` för ett eget API med `/api/mullvad/relays`, `/status` och `/switch`, samt `VPN_WISP_URL` för dess proxyutgång. Utan detta används direkt proxy.
- Molnspel: ange `CLOUD_API_URL` till en tjänst som implementerar frontendens `/cloud/v1/*`-kontrakt. `CLOUD_API_KEY` kan hållas på servern. En giltig leverantör och spelrättigheter krävs.
- Cheats: `JOIN_URL` anger den spel-/undervisningstjänst som knappen ska öppna. Utan egen JOIN_URL öppnas den offentliga Cheats-sidan från t9os.space genom TR-os-proxyn. Den integrationen beror på originaloperatörens tillgänglighet.
- Filmmetadata: `TMDB_API_KEY` kan sättas på servern. Filmplanschernas proxy följer samma API-bas som övriga anrop.

Detta är en självständig implementation för TR-os, inte referenssidans privata serverkod. Frontendens flöden bevaras, men tillgång till privata VPN-, AI- och molnspelstjänster ingår inte automatiskt.

## Bibliotek

Proxybiblioteken och deras licensnotiser finns kvar i källkoden. Serverns Wisp-implementation kommer från [MercuryWorkshop/wisp-js](https://github.com/MercuryWorkshop/wisp-js) och installeras som en separat npm-dependency. Lokala AI-anrop använder [Ollamas chat-API](https://docs.ollama.com/api/chat).

Den speglade Scramjet-filen är korrigerad på två ställen: service workerns IndexedDB-namn återställs från `%24scramjet.html` till `$scramjet`, samma namn som klienten använder. Även klientens modulgrupper (./dom/, ./worker/, ./shared/) och absoluta biblioteksadresser har återställts. Övriga tredjepartsnotiser behålls.

Sätt miljövariabeln `TR_OS_NETWORK_TEST=1` vid testkörning för det extra testet av en riktig utgående Wisp-ström. Övriga tester kräver ingen extern AI- eller molnspelsleverantör.

Spelens HTML filtreras före start och får ett annonsfilter för kända annonsdomäner och popupfönster. Korsdomänsramar kan begränsa filtret. Filmspelaren erbjuder VidFast, VidLink och VidSrc; upptäckta proxyfelsidor växlar till nästa källa. Tredjepartskällors innehåll/tillgänglighet kan inte garanteras.
