# Atlas cockpit

De hoofdapp is een persoonlijke bedieningsruimte: het woningmodel vormt het middelpunt, met daginformatie links en huisbediening rechts. Een compacte bovenconsole en een los scènedock laten de middenruimte vrij. Op telefoon staan dezelfde onderdelen onder elkaar, met vaste navigatie onderin.

## Visuele keuzes

- Diepe zwartblauwe achtergrond, transparante glaspanelen en fijne cyaanranden.
- Cyaan voor selectie en bediening; amber voor actieve verlichting en aandachtspunten.
- Geometrische HUD-ringen als stille decoratie. Geen verzonnen meetwaarden, netwerkstatus of exacte woningafmetingen.
- Geist voor leesbare tekst en grote tijdweergave; Geist Mono voor korte instrumentlabels en meetwaarden.
- Eén materiaal- en radiussysteem op Thuis, Overzicht, Apparaten, Camera’s en dialogen.
- Een begrensde cockpitbreedte op grote schermen; geen vaste sidebar.

## Toegepaste skills

De shadcn-skill is gebruikt voor projectinspectie, semantische themarollen, consistente componentopbouw, focus en toegankelijke dialogen. De bestaande app gebruikt vanilla TypeScript, zonder React of Tailwind. Er zijn daarom geen React-componenten uit shadcn/ui geïnstalleerd. De themarollen in `overhaul.css` volgen het shadcn-model: background/foreground, card, primary, muted, accent, border en ring.

UI UX Pro Max is gebruikt voor een ontwerpzoekopdracht voor een futuristische smart-home-cockpit, aangevuld met glassmorphism- en three.js-richtlijnen. De glasmaterialen en controlelijst zijn toegepast. De gegenereerde marketingstructuur en groene CTA-kleur passen niet bij Atlas en zijn niet overgenomen.

## Gedrag

De indeling respecteert bestaande blokkeuzes en de ochtend-/avondstand. Minder beweging schakelt animaties uit; er draaien geen nieuwe decoratieve animaties. De rustige stijl gebruikt dezelfde indeling. Telefoonnavigatie houdt rekening met safe areas en toetsenbordfocus.

Camera’s tonen het volledige bronbeeld en noemen de tijd van de laatste geslaagde momentopname. Onbekende gegevens blijven onbekend. De woningindeling blijft expliciet indicatief.

## Verificatie

Browsercontrole met lokale fixtures op 375, 768, 1024 en 1440 CSS-pixels: schermnavigatie, 2D/3D/Draai, ruimteselectie, lampbediening, camerawissel en vergroting. Fixtures hebben geen toegang tot echte apparaten of externe koppelingen. Productiebuild en de bestaande 29 regressietests blijven onderdeel van de controle.
