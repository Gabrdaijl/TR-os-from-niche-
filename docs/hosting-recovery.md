# Drift och flytt med befintliga medlemmar

## Återställ pågående driftstopp

Den 21 oktober 2026 svarade både `/` och `/api/health` med HTTP 503,
`x-render-routing: suspend-by-user` och Render-sidan "Service Suspended".
Detta svar kommer innan TR-os körs. Tjänsten måste återaktiveras i
Render-kontot; en kodpublicering eller Cloudflare-cache återaktiverar den inte.
Kontrollera driftkontots händelser och eventuella kapacitets- eller faktureringsmeddelanden.

Render-instansen är konfigurerad som `plan: free`. Den kan vila efter
inaktivitet och har inga garantier om ständig drift. Välj en driftplan som
passar kontinuerliga WebSocket-anslutningar när kostnaden har godkänts.

## Kontrollera databas och app separat

- `/api/health` kontrollerar att Node-servern svarar. Behåll denna som
  Render-hälsokontroll så att ett Redis-avbrott inte orsakar omstartsloopar.
- `/api/ready` gör ett skrivskyddat Redis-`PING` och svarar 200 när databasen
  svarar, annars 503. Kontrollerna samordnas och cachas i tio sekunder.
- GitHub-kontrollen använder `/api/ready` för att även larma om databasen
  inte svarar. Ett larm återställer inte en avstängd host automatiskt.

## Flytta samma app utan att flytta medlemsdata

1. Använd aktuell `main` och befintlig Dockerfile på en host med Node,
   utgående TCP och långlivade WebSockets. Cloudflare Containers är ett
   alternativ som kräver Workers Paid och förbrukningsbaserad betalning.
   En vanlig statisk Pages-publicering kör inte den befintliga backendens
   Wisp- och WebSocket-server.
2. Behåll exakt samma Redis-databas. Överför befintliga serverhemligheter via
   hostingens hemlighetshantering, särskilt `UPSTASH_REDIS_REST_URL` och
   `UPSTASH_REDIS_REST_TOKEN` (eller befintliga `KV_REST_API_*`-alias) samt
   `ADMIN_PASSWORD`. Kopiera övriga befintliga miljöinställningar.
   Lägg inga riktiga värden i GitHub eller klientkod.
3. Ta en återställningsbar backup hos databasleverantören före ändringen.
   Kontrollera antalet medlemmar skrivskyddat med
   `SCARD tros:membership:v1:users` före och efter. Behåll alla befintliga
   `tros:*`-nycklar, inklusive sessioner, betalningar, push och support.
   Skapa inte en ny tom databas och kör ingen återställning eller rensning.
4. Starta den nya hosten med `HOST=0.0.0.0`, `NODE_ENV=production` och hostingens
   port. Testa `/api/health`, `/api/ready`, befintlig medlemsinloggning,
   adminlistan, åtkomsttider och WebSocket-proxyn före DNS-byte.
5. Behåll `https://tr-os.me` som publik adress och samma cookieinställningar.
   Det bevarar webbläsarens enhets-ID och domänbundna inloggning. Byt DNS först
   när kontrollerna fungerar. Behåll möjlighet att återställa DNS till den
   tidigare tjänsten under övergången.

Ingen flytt, databasexport, DNS-ändring eller betaltjänst har aktiverats av
denna kodändring. Aktiverad host och webbläsaråtkomst krävs för livekontroller.

Referenser: [Render Free](https://render.com/docs/free),
[Cloudflare Containers](https://developers.cloudflare.com/containers/),
[Cloudflare Containers-priser](https://developers.cloudflare.com/containers/platform/pricing/).
