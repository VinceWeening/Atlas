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

## Zelf ontwikkelen

```bash
npm install
npm run build && npm start      # server + scherm op http://localhost:8790
npm run dev                     # alleen het scherm, met live herladen (server apart starten)
```

De Windows-app bouw je op Windows met `cd desktop && npm install && npm run build` (Rust en Node nodig).
