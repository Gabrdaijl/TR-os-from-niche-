# Flytta medlemsdatabasen till Aiven Valkey

Verktyget körs lokalt med Node 22.12 eller senare och projektets installerade beroenden. Det ändrar inte Render, DNS eller källdatabasen. Sätt aldrig anslutningslösenord i GitHub, kommandoradens argument eller webbläsarkod.

## Förutsättningar

- Skapa en **Valkey Free**-tjänst, inte PostgreSQL eller en tidsbegränsad provplan.
- Källan måste tillåta läsningar. `monthly_request_limit` måste lösas hos Upstash eller med en verifierad fullständig export innan en flytt kan slutföras. En tom måldatabas återställer inga medlemmar.
- Använd källans riktiga Redis TLS-URI och målets Valkey TLS-URI från respektive kontrollpanel. REST-URL och REST-token är inte en Redis TLS-URI.
- Stoppa alla skrivare mot källan under export, import och kontroll: Render, gamla instanser och Vercel. Även bakgrundsjobb, närvaro och adminanrop kan skriva. Verktyget pausar inte tjänster åt dig.
- Målet ska vara tomt och isolerat från applikationer under hela kontrollen. Importen vägrar skriva över en befintlig databas. Vid avbrott kan målet innehålla en delvis färdig import; börja inte om mot den utan att först inspektera den.

## Export, import och kontroll

Ange värden privat i processens miljö eller en lokal ignorerad `.env.migration`-fil. Node stöder `--env-file=.env.migration`. Filen ska innehålla följande variabelnamn med värden från kontrollpanelerna:

```dotenv
REDIS_MIGRATION_SOURCE_URL=
REDIS_MIGRATION_DESTINATION_URL=
REDIS_MIGRATION_ARCHIVE=data/redis-migration.json
REDIS_MIGRATION_SOURCE_PAUSED=yes
REDIS_MIGRATION_DESTINATION_ISOLATED=yes
```

Sätt bekräftelserna till `yes` först när förutsättningarna är uppfyllda. Kör i projektmappen:

```sh
node --env-file=.env.migration scripts/migrate-redis.cjs export
node --env-file=.env.migration scripts/migrate-redis.cjs import
node --env-file=.env.migration scripts/migrate-redis.cjs verify
```

Exporten måste lyckas och sparas fullständigt innan importen påbörjas. Arkivet innehåller känsliga medlemsuppgifter och lösenordshashar; det är inte krypterat. Det får bara sparas under ignorerade `data/`, aldrig skrivas över automatiskt, och skapas med ägarbehörighet på system som stöder den. Kontrollera Windows-mappens åtkomst och behåll en privat återställningskopia.

Vid egna CA-certifikat finns `REDIS_MIGRATION_SOURCE_CA_CERT` och `REDIS_MIGRATION_DESTINATION_CA_CERT` (PEM, även bokstavliga `\n`). TLS-verifiering är på. Sammanfattningarna innehåller endast antal och kontrollsummor.

Verktyget bevarar binära nycklar och värden för string, list, set, hash och zset, inklusive HyperLogLog som string. Nycklarnas absoluta sluttid bevaras; utgångna sessioner återupplivas inte. Källan behöver stödja `PEXPIRETIME`. Okända typer stoppar exporten. Strömmar, moduler och separata utgångstider för hashfält stöds inte; använd en kompatibel fullständig export om sådana finns. Standardgränserna är 100 000 nycklar och ett arkiv på 256 MiB; större datamängder kräver en granskad anpassning. SCAN är ingen atomisk ögonblicksbild: kontroll av nycklar ersätter inte kravet att stoppa alla skrivare.

## Koppla om först efter verifiering

Behåll samma övriga hemligheter och inställningar, särskilt admin- och sessionsnycklar. Sätt i Render:

```dotenv
REDIS_BACKEND=valkey
VALKEY_URL=
```

`VALKEY_URL` ska innehålla målets hemliga `valkeys://`- eller `rediss://`-URI. Lägg till `VALKEY_CA_CERT` endast om det krävs. Driftsätt och kontrollera `/api/ready`, en befintlig medlemssession, adminens medlems- och betalningslistor samt sparad supportinformation. Ett grönt hälsosvar visar anslutningen men bevisar inte att rätt uppgifter kopierats. Släpp på skrivtrafiken först när kontrollerna är klara.

Behåll källan och originalarkivet. En återställning efter att nya skrivningar skett i målet kräver att de ändringarna förs tillbaka; ett enkelt anslutningsbyte kan annars förlora senare ändringar.
