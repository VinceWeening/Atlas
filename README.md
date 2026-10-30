# Atlas

Persoonlijk levenssysteem van Vince: één rustig overzicht van huis, agenda, mail en weer, later met spraakassistent "Hey Atlas".

Het plan in fases staat in het projectdocument "Atlas – plan in fases", de stijl in `DESIGN.md` bij de projectbestanden.

## Hoe het in elkaar zit

| Deel | Map | Draait op |
| --- | --- | --- |
| Server: haalt gegevens op en serveert het scherm | `server/` | ZimaOS (Docker) |
| Webscherm: het overzicht met het huis in 3D | `web/` | Wordt door de server geserveerd |
| Windows-app: venster, systeemvak, autostart | `desktop/` | Je pc |

De pc-app bewaart geen inloggegevens. Hij opent alleen de pagina van de server. Telefoon en TV kunnen later dezelfde pagina openen via Tailscale.

## Fase 1 installeren

### 1. Server op ZimaOS

1. Na het samenvoegen van de pull request bouwt GitHub automatisch het image `ghcr.io/vinceweening/atlas:latest` (tabblad Actions, "Server-image").
2. Omdat de repository privé is, is het image ook privé. Kies één van de twee:
   - Zet het pakket op openbaar: GitHub › je profiel › Packages › atlas › Package settings › Change visibility. Er zit geen geheime informatie in.
   - Of log op ZimaOS in bij `ghcr.io` met een GitHub-token dat `read:packages` mag.
3. In ZimaOS: App Store › Eigen app installeren (Custom install) › importeer `docker-compose.yml` uit deze repository.
4. Open `http://<naam-van-je-zimaos-in-tailscale>:8790` in je browser. Je ziet Atlas met voorbeeldgegevens.

### 2. Windows-app

1. Ga op GitHub naar Actions › "Windows-app" › de laatste groene run › download `atlas-windows-installer`.
2. Pak het zip-bestand uit en installeer het `.msi`-bestand.
3. Bij de eerste start vraagt Atlas om het server-adres, bijvoorbeeld `http://zimaos:8790` (de Tailscale-naam van je ZimaOS).

Daarna start Atlas met Windows mee, stil in het systeemvak. Klik op het icoon om het venster te openen. Sluiten verstopt het venster; echt afsluiten gaat via het menu van het icoon. Daar kun je ook het server-adres wijzigen.

## Home Assistant koppelen

Atlas vraagt zelf aan Home Assistant welke ruimtes, lampen, temperatuursensoren, camera's, scènes en weerbericht er zijn. Je hoeft niets per lamp in te stellen.

1. Open Home Assistant, klik linksonder op je profiel en ga naar **Beveiliging**.
2. Maak onderaan een **langdurige toegangscode** aan, bijvoorbeeld met de naam "Atlas", en kopieer hem.
3. Open in ZimaOS de instellingen van de app Atlas en vul bij de omgevingsvariabelen in:
   - `HA_URL`: het adres van Home Assistant, bijvoorbeeld `http://192.168.1.10:8123` (niet `localhost`, want Atlas draait in zijn eigen container).
   - `HA_TOKEN`: de code uit stap 2.
   - `HA_VOORDEUR` (optioneel): de camera die vooraan moet staan, bijvoorbeeld `camera.voordeur`.
4. Sla op; de app start opnieuw en toont je eigen huis.

Lampen verschijnen in de kamer waaraan ze in Home Assistant zijn toegewezen. De plattegrond koppelt een kamer op naam (bijvoorbeeld "Woonkamer" of "Keuken"); kamers die niet op de plattegrond staan kies je in de keuzelijst van het kamerpaneel. Lampen zonder ruimte staan onder "Overige lampen".

Dimbare lampen krijgen een schuifje voor de helderheid, en lampen die warm en koel wit kunnen een tweede schuifje daarvoor. Bij het grote camerabeeld (scherm Camera's) staan de instellingen van de camera zelf: alles wat Home Assistant bij die camera heeft, zoals IR-licht, dag/nacht-stand, spotlight, sirene en de schakelaars van Frigate (detectie, opnemen). Knoppen die een camera herstarten, resetten of bijwerken laat Atlas bewust weg.

## Meldingen van Frigate

Atlas kijkt elke vijf seconden of Frigate iets nieuws heeft gezien en stuurt een melding naar je pc, je telefoon of allebei.

1. Atlas zoekt Frigate zelf op poort 5000: als container `frigate`, op de server waar Atlas draait en op de machine van Home Assistant. Vindt Atlas hem niet (het tandwiel zegt het dan), vul dan bij de app Atlas in ZimaOS `FRIGATE_URL` in, bijvoorbeeld `http://192.168.1.10:5000`. Poort 5000 is de interne poort zonder inlog.
2. Open het tandwiel in Atlas. Onder **Meldingen** kies je:
   - **Pc**: een Windows-melding via de Atlas-app, ook als het venster in het systeemvak staat.
   - **Telefoon**: een melding via de Home Assistant-app. Kies je telefoon in de lijst; daar staat elke telefoon met de Home Assistant-app die aan Home Assistant gekoppeld is.
   - Welke dingen een melding geven (standaard alleen personen), welke camera's meedoen en hoe lang een camera daarna stil blijft.
3. Druk op **Testmelding** om te zien of alles aankomt.

Windows-meldingen werken vanaf deze versie van de Windows-app; installeer de nieuwe installer uit GitHub Actions eenmalig opnieuw. De app haalt meldingen op via een `http://`-adres (zoals via Tailscale). Staat het venster open en vooraan, dan verschijnt de melding in Atlas zelf.

## Blokken voor je server-apps

Atlas zoekt Frigate, Jellyfin, Seerr, Sonarr en Radarr zelf op hun standaardpoort (5000, 8096, 5055, 8989 en 7878). Frigate staat standaard aan, de rest zet je aan in het tandwiel onder **Blokken**. Zonder sleutel ziet Atlas alleen of de app draait en kun je hem openen; met een sleutel komt de inhoud in het blok:

| Blok | Variabele | Waar vind je de sleutel | Wat je dan ziet |
| --- | --- | --- | --- |
| Jellyfin | `JELLYFIN_KEY` | Dashboard › API-sleutels › + | Verder kijken en nieuw toegevoegd |
| Seerr | `SEERR_KEY` | Instellingen › Algemeen › API-sleutel | Wachtende en lopende aanvragen |
| Downloads | `SONARR_KEY`, `RADARR_KEY` | Settings › General › API Key | Wat er nu downloadt, met voortgang |

Vul de sleutels in bij de app Atlas in ZimaOS. Draait een app op een andere poort of machine, vul dan het adres in, bijvoorbeeld `JELLYFIN_URL`, `JELLYSEERR_URL`, `SONARR_URL` of `RADARR_URL`.

## Google Agenda en Gmail koppelen

Atlas leest je agenda's en je belangrijke ongelezen mail, alleen lezen. Daarvoor maak je eenmalig een eigen, gratis koppeling in Google Cloud. Er gaat niets via een externe dienst.

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com), log in met je Google-account en maak een nieuw project, bijvoorbeeld "Atlas".
2. Zoek bovenin naar **Google Calendar API** en klik op **Inschakelen**. Doe hetzelfde voor **Gmail API**.
3. Ga naar **Google Auth Platform** (of "OAuth-toestemmingsscherm") en klik op **Aan de slag**:
   - App-naam: Atlas, ondersteuningsmail: je eigen adres.
   - Doelgroep: **Extern**.
   - Contactgegevens: je eigen adres. Accepteer de voorwaarden en klik op **Maken**.
4. Ga onder Google Auth Platform naar **Doelgroep** en klik op **App publiceren** (status "In productie"). In de teststatus verloopt de koppeling na 7 dagen. Een melding dat de app niet geverifieerd is, mag je negeren: alleen jij gebruikt hem.
5. Ga naar **Clients**, klik op **Client maken**, kies als type **Desktop-app** en noem hem "Atlas". Je krijgt een client-ID en een clientgeheim.
6. Vul die in ZimaOS bij de app Atlas in als `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET` en sla op.
7. Open Atlas, klik op het tandwiel en daarna op **Open Google**:
   - Kies je account. Bij "Google heeft deze app niet geverifieerd" klik je op **Geavanceerd** en **Ga naar Atlas**, en geef je toestemming.
   - Je komt op een pagina die niet laadt (`127.0.0.1`). Dat hoort zo: kopieer het hele adres uit de adresbalk, plak het in Atlas en klik op **Koppelen**.

Daarna kies je in het tandwiel welke agenda's Atlas laat zien. De koppeling staat in het volume `atlas-data`, dus een update van Atlas laat hem staan.

## Atlas op je telefoon

Atlas werkt op de telefoon als een gewone app, met een eigen icoon en zonder adresbalk.

1. Zet Tailscale aan op je telefoon.
2. Open Atlas in Safari (iPhone) of Chrome (Android) via de Tailscale-naam van je server, bijvoorbeeld `http://zimaos:8790`.
3. iPhone: tik op Deel › **Zet op beginscherm**. Android: menu › **App installeren**.

Voor de snelste versie, die ook opent als de verbinding even hapert, heeft de telefoon een `https://`-adres nodig. Dat kan met Tailscale zelf. Zet in de Tailscale-beheerpagina **HTTPS Certificates** aan (DNS › HTTPS) en draai dan eenmalig in de terminal van ZimaOS:

```sh
sudo tailscale serve --bg 8790
```

Atlas staat dan op `https://<naam-van-je-server>.<jouw-tailnet>.ts.net`. Zet dat adres op je beginscherm.

## Ochtend, avond, lucht en stille uren

- **Ochtendstand** (standaard 6:00 tot 10:00): een begroeting met je afspraken en de eerstvolgende deadline bovenaan.
- **Avondstand** (standaard 21:00 tot 1:00): alleen nog de kamer, de camera en de knoppen, met wat er morgen is.
- **Lucht zoals buiten**: de achtergrond is licht, schemerig of donker zoals het nu in Heiloo is, met de zon of de maan (in de juiste fase) op hun plek.
- **Stille uren** (bij Meldingen, standaard uit): geen meldingen op pc of telefoon. Wat de camera's zagen, staat wel in **Vandaag gezien** op Overzicht en bij Camera's.

Alles is aan en uit te zetten in het tandwiel, en de tijden zijn aan te passen.

## Energie en klimaat

Het blok **Energie en klimaat** op Overzicht zoekt de meters zelf in Home Assistant: een P1-meter (DSMR of HomeWizard) voor stroom en teruglevering, de gasmeter, zonnepanelen (SolarEdge, omvormer) voor opwek, de eerste thermostaat (`climate.*`) en per ruimte de temperatuur en luchtvochtigheid. Het verbruik van vandaag is de meterstand nu min die om middernacht, uit de geschiedenis van Home Assistant. Slimme stekkers telt Atlas bewust niet mee als "het huis". Zonder meters of sensoren verdwijnt het blok vanzelf.

## Opdrachtbalk en spraak

Druk **Ctrl+K** of **/** (of tik op het sterretje rechtsboven) en typ wat Atlas moet doen:

- `woonkamer uit`, `keuken aan`, `alle lampen uit`
- `dim bureau naar 30%`, `bureau feller`
- `filmavond` (een scène), `welterusten` (scène Slapen, of alle lampen uit)
- `hoe warm is het in de keuken`, `welke lampen zijn aan`, `hoeveel stroom gebruiken we`
- `ga naar camera's`

Atlas begrijpt een vaste set zinnen (geen AI) en bedient alleen lampen, schakelaars en scènes; sloten nooit. Met het blok **Spraakbol** aan tik je op de bol onderin en spreek je de opdracht in; het antwoord komt dan ook hardop. Dat gebruikt de spraakherkenning van de browser (Chrome, Edge, Safari op de iPhone). Werkt die niet, dan typ je.

### Spraak en lokale AI op je eigen server

Met een eigen Whisper (spraak naar tekst) en Ollama (lokale AI) werkt spraak ook in de Windows-app, blijft je stem thuis, en kun je Atlas gewone vragen stellen. Beide staan klaar in `docker-compose.ai.yml`, als aparte app naast Atlas:

1. ZimaOS: App Store › Eigen app installeren › `docker-compose.ai.yml` importeren. Dat zijn twee containers, `atlas-ollama` en `atlas-whisper`, met een geheugengrens van 3 GB en 1,5 GB.
2. Zet bij Atlas `WHISPER_URL` op `http://host.docker.internal:8000` en `OLLAMA_URL` op `http://host.docker.internal:11434`, en start Atlas opnieuw.
3. Atlas haalt de modellen de eerste keer zelf op (samen ruim 2 GB). Tandwiel › Koppelingen laat zien of dat nog bezig is.

Kijk bij Tandwiel › Koppelingen › **Ruimte voor spraak en AI** of het past: Atlas meet het vrije geheugen en de schijf van de server en zegt welk model erin past. Past `qwen2.5:3b` niet, zet dan `OLLAMA_MODEL` op `qwen2.5:1.5b`. Na tien minuten zonder vragen geeft Ollama het geheugen weer vrij. Uitzetten kan altijd: stop de app `atlas-ai`, of zet in het tandwiel bij **Spraak en AI** de vragen of het hardop antwoorden uit.

Wat het dan doet:

- **Spreken**: Ctrl+Spatie of de spraakbol. Atlas neemt op tot je even stil bent, Whisper maakt er tekst van, en de opdracht wordt uitgevoerd. Elke server die `/v1/audio/transcriptions` kent werkt.
- **Onbekende zinnen**: "maak het donker in de woonkamer" herschrijft het model naar een zin die Atlas kent ("woonkamer uit"), en dat zie je erbij staan.
- **Vragen**: "wat staat er vandaag nog?", "moet ik een jas aan?", "wanneer moet ik weg?". Het model krijgt een kort overzicht van je agenda, belangrijke mail, het weer, de lampen, energie, afval en wie er thuis is, en antwoordt in een of twee zinnen. Er staat "lokale AI" achter, zodat je weet waar het vandaan komt.

Het model bedient zelf nooit iets: alleen de vaste zinnen doen iets in huis, en sloten en camera's nooit.

## Het draaibare 3D-huis

Kies naast het huis **Draai** voor een echt 3D-model (three.js): slepen draait, scrollen zoomt, klikken kiest een ruimte. Ruimtes met licht aan gloeien warm. Het model gebruikt dezelfde indeling als de plattegrond (`web/src/huis.ts`), dus de echte indeling komt er vanzelf in te staan. Het model wordt pas geladen als je Draai kiest.

## Controleren wat werkt

Tandwiel › Koppelingen › **Wat Atlas vindt** laat per onderdeel zien of het werkt: Home Assistant (met het aantal ruimtes en lampen), personen, energiemeters, afval, Frigate, meldingen, Google, Whisper, Buienradar, Ollama en of er genoeg geheugen en schijf is voor spraak en AI. Een warme stip is iets om naar te kijken, grijs staat uit.

## Thuis en weg, vertrekhulp en afval

- **Thuis en weg** (tandwiel › Meldingen, staat uit): Atlas volgt de personen in Home Assistant. Gaat de laatste weg terwijl er lampen branden, dan krijg je op je telefoon één melding met de knop *Alles uit*. Atlas hoort die knop via de websocket van Home Assistant. Met *Camera's alleen als je weg bent* blijft je telefoon stil als er iemand thuis is (de pc meldt altijd).
- **Vertrekhulp**: voor je volgende afspraak met een locatie rekent Atlas terug met de reistijd uit tandwiel › Data (een vaste tijd, of per plek zoals `Xafax = 25`). De regen komt van Buienradar voor Heiloo (andere plek: `ATLAS_LAT` en `ATLAS_LON`).
- **Afvalkalender**: installeer in Home Assistant de integratie *Afvalwijzer* (kies HVC voor Heiloo) of *Waste Collection Schedule*. Atlas vindt de sensoren zelf en zet de ophaaldagen van vandaag tot overmorgen bij Belangrijk; 's avonds staat erbij wat er morgen aan de straat moet.

## Het tandwiel

Het tandwiel heeft tabbladen: Scherm, Data, Meldingen, Knoppen en Koppelingen.

- **Blokken**: zet elk blok aan of uit, ook het huis. Staat het huis uit, dan gaat het naar de achtergrond; met de knop "Huis" bovenin haal je het weer naar voren.
- **Startscherm**: kies per apparaat tussen Thuis (huis met blokken eromheen) en Overzicht (alleen blokken in een raster). Standaard is dat Thuis op de pc en Overzicht op de telefoon.
- **Belangrijke data**: deadlines (alleen een datum) en periodes (van en t/m, met voortgangsbalk). Ze staan in het blok Belangrijk.

Alles wordt op de server bewaard in het volume `atlas-data`, dus pc en telefoon laten hetzelfde zien.

## Zelf ontwikkelen

### Rust en meldingen

Onder **Instellingen → Scherm → Rust en overzicht** kies je rustige vormgeving, beweging aan/uit en 1, 3 of 5 regels voor agenda en mail. Met **Rustige basisindeling** vouw je extra kaarten in op Overzicht; je kunt elk blok daarna zelf uitvouwen of aan/uit zetten. Bestaande blokkeuzes blijven behouden totdat je die knop gebruikt.

De knop **Meldingen** in de bovenbalk opent direct de meldingsinstellingen. Pop-ups in de pagina, Windows-meldingen en telefoonmeldingen hebben eigen schakelaars. Pauzeer meldingen voor één of acht uur, hervat ze, stel stille uren in en kies een pop-upduur van 4, 8 of 12 seconden. Per ophaalronde verschijnt maximaal één pop-up; bij meerdere gebeurtenissen zie je het aantal. Camera's, personen, zones en gezichtsfilters staan onder een uitklapbaar onderdeel. Stille en gepauzeerde cameragebeurtenissen blijven in Vandaag gezien beschikbaar. Een expliciete testmelding omzeilt de stilte, maar respecteert uitgeschakelde kanalen.

De melding **Lampen nog aan / Alles uit?** volgt eveneens de telefoonschakelaar, stille uren en tijdelijke pauze. De instelling **Camera's alleen als je weg bent** geldt zoals voorheen alleen voor de telefoon.

`npm test` controleert migratie van bestaande instellingen, invoervalidatie, kanalen, stille uren over middernacht, het aflopen van pauzes en de echte vertrekherinneringsroute. Deze tests gebruiken tijdelijke gegevens en sturen geen echte meldingen.

```bash
npm install
npm run build && npm start      # server + scherm op http://localhost:8790
npm run dev                     # alleen het scherm, met live herladen (server apart starten)
```

De Windows-app bouw je op Windows met `cd desktop && npm install && npm run build` (Rust en Node nodig).
