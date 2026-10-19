# Gratis provflytt till Render

`render.yaml` skapar endast en webbtjänst på **Free**. Ingen betalplan, extra databas eller disk skapas. Ange inte något betalkort för att undvika automatiska trafikavgifter. Kontrollera att kontots arbetsyta också är gratis innan publicering.

## Begränsningar

Detta är ett gratisalternativ för provdrift, inte ett löfte om ständig tillgänglighet. Render kan pausa gratis tjänster vid trafikgränser eller ovanligt hög utgående trafik. TR-os proxy skickar mycket trafik och kan därför nå gränserna även här. Tjänsten sover efter 15 minuter utan trafik och kan behöva ungefär en minut för att starta igen. Se https://render.com/docs/free och https://render.com/docs/websocket.

## Publicering

1. Anslut GitHub-repot till Render och välj Blueprint med `render.yaml`. Kontrollera rätt branch och Free-plan.
2. Ange ADMIN_PASSWORD direkt i Renders hemliga miljövariabler. Återanvänd befintlig Upstash-databas genom att konfigurera UPSTASH_REDIS_REST_URL och UPSTASH_REDIS_REST_TOKEN direkt i kontrollpanelen. Lägg aldrig dessa värden i koden. Kontrollera även databasens gratisgränser.
3. Testa den nya onrender.com-adressen: hälsokontroll, admin, rapport med bild, trafikräkning och WebSocket. Testa Snapchat med ett inloggat konto: skicka snap, ta emot snap och ett samtal i båda riktningar. En laddad inloggningssida räcker inte.
4. Lägg först därefter till tr-os.me och www.tr-os.me i Render. Ändra DNS till exakt de poster som Render visar för tjänsten. Låt TLS bli klart och verifiera båda adresserna. Ändra inte DNS till en obekräftad tjänst.

Ingen domän flyttas automatiskt av YAML-filen. Befintliga extra leverantörsinställningar för AI, VPN och cloud behöver konfigureras separat om de används. Chatt i serverminnet försvinner vid omstart, medan trafik och rapporter använder extern Redis.

## Trafikstatistik

Admin visar idag (Europe/Stockholm), rullande 7 dagar, rullande 30 dagar och **Totalt · alla tider**. En webbläsare delar anonymt ID mellan flikar; flera webbläsare är flera ID:n. Ingen identifiering eller fingerprint av fysiska enheter görs. Nya webbläsare betyder att ID:t inte setts under föregående 30 dagar. Sidvisningar är sidöppningar av TR-os dokument, inte bakgrundslivssignaler eller besök på proxade externa sidor. Inbäddade sidor delar förälderns räknare. Historik byggs från publiceringen och kan inte återskapas retroaktivt. Poster för rullande perioder rensas efter 30 dagar och dessa nycklar försvinner efter 31 dagar utan aktivitet. Databasfel visas som okänt, även för totalerna.

Totalerna börjar vid första registrerade besöket efter att den här funktionen publicerats; starttid visas i admin och ingen äldre historik fylls på automatiskt. Två permanenta Redis HyperLogLog-nycklar uppskattar unika webbläsar-ID:n och unika kombinationer av webbläsar-ID + dokument-ID. De har ingen TTL och kräver högst cirka 12 KB vardera. Samma dokument-ID räknas inte på nytt i totalerna vid återförsök efter att 30-dagarshistoriken löpt ut. Alla tre totalvärden är uttryckligen ungefärliga (Redis anger 0,81 % standardfel), inte exakta räknare. Nya webbläsare totalt betyder första förekomst under hela mätningen och motsvarar därför totalt antal unika webbläsare. Totaler nollställs inte vid deploy eller serveromstart när samma externa Redis används, men förloras om databasen töms eller nycklarna raderas.

Teknisk referens: https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/
