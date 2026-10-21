# Flytta TR-os till en Linux-server

Det här är ett förberett körpaket för samma Node-server och samma externa
Redis-databas. Det skapar inga molnresurser och aktiverar ingen betalplan.
Webbplatsens sidor och medlemsnycklar ändras inte.

## Kostnad och konto först

För Azure: aktivera **Azure for Students** och kontrollera att krediten och
spärren mot debitering är aktiva innan en VM skapas. Ett godkänt GitHub
Student Pack innebär inte att Azure-erbjudandet redan är aktiverat.
VM, disk, publik IP och utgående trafik måste rymmas inom tillgängliga
gratiskvoter och studentkredit. Behåll spärren mot Pay As You Go.
Om krediten tar slut kan tjänsten stoppas. Paketet garanterar inte drift
utan avbrott.

## Samma medlemsdata

1. Använd databasleverantörens backupfunktion före flytten.
2. Spara serverns befintliga miljövariabler i `/etc/tr-os/app.env` på den nya
   servern, med filrättigheter `0600`. Använd exakt samma
   `UPSTASH_REDIS_REST_URL` och `UPSTASH_REDIS_REST_TOKEN` eller befintliga
   `KV_REST_API_*`-alias, samma `ADMIN_PASSWORD` och övriga tjänsteinställningar.
   Skapa inte en ny Redis-databas. Inga riktiga hemligheter ska läggas i repot.
3. Kontrollera medlemsantalet skrivskyddat med
   `SCARD tros:membership:v1:users` före och efter. Bevara alla `tros:*`-nycklar.
4. Behåll `tr-os.me` som publik domän för cookies och sparade enhets-ID:n.

## Start på Linux-VM

Installera Docker Engine och Compose-plugin från Dockers officiella källa.
Aktivera Docker vid serverstart. Tillåt inkommande TCP 80 och 443 i både
hostingens och serverns brandvägg. Begränsa SSH till administratörens IP.
Appens port 8173 är bunden till loopback och ska inte exponeras offentligt.

Kör från repo-roten på Linux-servern:

```sh
docker compose -f deploy/linux/compose.yaml config --quiet
docker compose -f deploy/linux/compose.yaml up -d --build --wait
curl --fail http://127.0.0.1:8173/api/health
curl --fail http://127.0.0.1:8173/api/ready
```

Verifiera appen och samma medlemsdata före DNS-byte. Caddy utfärdar och
förnyar TLS-certifikat när domänen pekar till den nya servern och
certifikatkontrollen når TCP 80/443. Kontrollera därefter HTTPS, inloggning,
adminens medlemslista, åtkomsttider och webbproxyn via `tr-os.me`.
Behåll tidigare DNS-värden för återställning om kontrollen misslyckas.

## Återstart och loggar

Docker återstartar en kraschad container och återupptar körning efter att
Docker-servern startat, så länge containern inte stoppats manuellt.
Det ersätter inte en avstängd VM, ett nätavbrott eller en förbrukad gratiskvot.
En container med status `unhealthy` återstartas inte av denna policy.
Loggar roteras så att de inte kan fylla hela disken.

```sh
docker compose -f deploy/linux/compose.yaml ps
docker compose -f deploy/linux/compose.yaml logs --tail=100 app
```

Använd `/api/ready` för att även upptäcka databasavbrott. Den redan befintliga
GitHub-kontrollen kan larma om avbrott när GitHub Actions är aktiverat.
Ingen medlemsdata ska rensas vid felsökning eller omstart.
