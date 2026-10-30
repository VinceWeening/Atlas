// Het tandwiel: blokken aan/uit, startscherm, belangrijke data en de Google-koppeling.
import { meldFout } from './melding';

type Scherm = 'thuis' | 'overzicht';
export type Datum = { id: string; titel: string; datum: string; van: string | null };
export type Meldingen = {
  pc: boolean;
  telefoon: boolean;
  toestel: string | null;
  soorten: string[];
  camerasUit: string[];
  wachttijd: number;
  zones: string[];
  bekenden: string[];
  stil: Periode;
};
/** Een stuk van de dag, zoals 23:00 tot 07:00; mag over middernacht gaan. */
export type Periode = { aan: boolean; van: string; tot: string };
export type Instellingen = {
  blokken: Record<string, boolean>;
  start: { breed: Scherm; smal: Scherm };
  belangrijk: Datum[];
  meldingen: Meldingen;
  favorieten: string[];
  snelkoppelingen: string[];
  namen: Record<string, string>;
  standen: { ochtend: Periode; avond: Periode };
  weg: { aan: boolean; allesUit: boolean; alleenWeg: boolean };
  vertrek: { reistijd: number; plekken: { naam: string; minuten: number }[] };
};
type Opties = {
  frigate: { ingesteld: boolean; bereikbaar: boolean };
  cameras: string[];
  toestellen: { id: string; naam: string }[];
  soorten: string[];
  zones: string[];
  gezichten: string[];
};

const SOORTNAMEN: Record<string, string> = {
  person: 'Personen',
  car: "Auto's",
  bicycle: 'Fietsen',
  motorcycle: 'Motoren',
  dog: 'Honden',
  cat: 'Katten',
  bird: 'Vogels',
  package: 'Pakketten',
};
const cameraNaam = (camera: string) => camera.replace(/_/g, ' ').replace(/^\w/, (l) => l.toUpperCase());
type Agenda = { id: string; naam: string; kleur: string | null; aan: boolean };
type GoogleStatus = { ingesteld: boolean; gekoppeld: boolean; agendas: Agenda[] };

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

function knop(tekst: string, klasse = 'knop') {
  const k = maak('button', klasse, tekst);
  k.type = 'button';
  return k;
}

async function stuur(adres: string, methode: string, body?: unknown) {
  const antwoord = await fetch(adres, {
    method: methode,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await antwoord.json().catch(() => ({}));
  if (!antwoord.ok) throw new Error(data.fout ?? `Server gaf ${antwoord.status}`);
  return data;
}

const BIJWERKEN =
  'sudo docker pull ghcr.io/vinceweening/atlas:latest && cd "$(sudo docker inspect atlas --format \'{{ index .Config.Labels "com.docker.compose.project.working_dir" }}\')" && sudo docker compose up -d';

// Blokken per plek, met één regel uitleg, zodat je weet wat je aan- of uitzet.
const BLOKGROEPEN: [string, [string, string, string][]][] = [
  [
    'Thuis en Overzicht',
    [
      ['huis', 'Huis', 'Het 3D-huis in het midden van Thuis'],
      ['vandaag', 'Vandaag', 'Afspraken van vandaag en morgen'],
      ['belangrijk', 'Belangrijk', 'Deadlines en periodes uit het tabblad Data'],
      ['mail', 'Mail', 'Belangrijke mail uit Gmail'],
      ['kamer', 'Kamer', 'De gekozen kamer met al zijn lampen'],
      ['camera', 'Camera', 'Beeld van de voordeur en andere camera’s'],
      ['favorieten', 'Favorieten', 'Lampen met een ster, in het dock onderin'],
      ['scenes', 'Knoppen onderin', 'Scènes of je eigen knoppen in het dock'],
      ['hud', 'Status bovenin', 'Temperatuur binnen, lampen aan en de voordeur'],
      ['tijdlijn', 'Vandaag gezien', 'Wie of wat de camera’s vandaag zagen, op Overzicht'],
      ['energie', 'Energie en klimaat', 'Stroom, gas, zon en de temperatuur per ruimte, op Overzicht'],
      ['vertrek', 'Vertrekhulp', 'Hoe laat je weg moet voor je volgende afspraak, en of het regent'],
      ['afval', 'Afvalkalender', 'Ophaaldagen bij Belangrijk, en ’s avonds wat er morgen buiten moet'],
    ],
  ],
  [
    'Overzicht: media en server',
    [
      ['jellyfin', 'Verder kijken', 'Wat je in Jellyfin aan het kijken bent'],
      ['downloads', 'Downloads', 'Sonarr en Radarr'],
      ['seerr', 'Aanvragen', 'Seerr: wat er wacht en wat er klaar is'],
      ['frigate', 'Frigate', 'Wat de camera’s vandaag zagen'],
    ],
  ],
  [
    'Extra',
    [
      ['lucht', 'Lucht zoals buiten', 'Licht of donker met de zon en maan op hun echte plek'],
      ['opdracht', 'Opdrachtbalk', 'Ctrl+K of /: typ wat Atlas moet doen, zoals ‘woonkamer uit’'],
      ['spraak', 'Spraakbol', 'Onderin: tik en spreek een opdracht in'],
      ['sneltoetsen', 'Sneltoetsen', '1 t/m 4 voor de schermen, pijltjes voor de verdiepingen'],
    ],
  ],
];

function schakelaarRij(naam: string, aan: boolean, wissel: (aan: boolean) => Promise<void>, uitleg?: string) {
  const rij = maak('div', 'lamp');
  const info = maak('div', 'lamp-info');
  if (uitleg) {
    const namen = maak('span');
    namen.append(naam, maak('small', undefined, uitleg));
    info.append(namen);
  } else info.textContent = naam;
  rij.append(info);
  const schakelaar = knop('', 'schakelaar');
  schakelaar.setAttribute('role', 'switch');
  schakelaar.setAttribute('aria-checked', String(aan));
  schakelaar.setAttribute('aria-label', naam);
  schakelaar.addEventListener('click', async () => {
    aan = !aan;
    schakelaar.setAttribute('aria-checked', String(aan));
    try {
      await wissel(aan);
    } catch {
      aan = !aan;
      schakelaar.setAttribute('aria-checked', String(aan));
      meldFout('Bewaren lukte niet');
    }
  });
  rij.append(schakelaar);
  return rij;
}

/** Een rij met een schakelaar en twee tijden (van, tot), voor de standen en de stille uren. */
function periodeRij(naam: string, uitleg: string, p: Periode, bewaar: (p: Periode) => Promise<void>) {
  const rij = schakelaarRij(naam, p.aan, (aan) => bewaar((p = { ...p, aan })), uitleg);
  const tijden = maak('div', 'inst-tijden');
  for (const deel of ['van', 'tot'] as const) {
    const veld = maak('input', 'inst-veld tijd-veld');
    veld.type = 'time';
    veld.value = p[deel];
    veld.setAttribute('aria-label', `${naam} ${deel}`);
    veld.addEventListener('change', async () => {
      if (!/^\d{2}:\d{2}$/.test(veld.value)) return;
      const vorig = p;
      p = { ...p, [deel]: veld.value };
      try {
        await bewaar(p);
      } catch {
        p = vorig;
        veld.value = vorig[deel];
        meldFout('Bewaren lukte niet');
      }
    });
    tijden.append(veld);
    if (deel === 'van') tijden.append(maak('span', 'muted klein', 'tot'));
  }
  rij.classList.add('periode');
  rij.append(tijden);
  return rij;
}

export function instellingen(terug: { google: () => void; opgeslagen: (inst: Instellingen) => void }) {
  const venster = document.getElementById('instellingen') as HTMLDialogElement;
  const inhoud = document.getElementById('instellingen-inhoud')!;
  const naVerandering = terug.google;

  async function bewaar(deel: { [K in keyof Instellingen]?: Partial<Instellingen[K]> }) {
    const inst: Instellingen = await stuur('/api/instellingen', 'PUT', deel);
    terug.opgeslagen(inst);
    return inst;
  }

  async function tekenAlgemeen() {
    let inst: Instellingen;
    try {
      inst = await (await fetch('/api/instellingen')).json();
    } catch {
      return null;
    }

    const blokken = maak('section', 'inst-sectie');
    blokken.append(
      maak('h3', 'lbl', 'BLOKKEN'),
      maak('p', 'muted klein', 'Staat het huis uit, dan gaat het naar de achtergrond. Met de huisknop bovenin haal je het weer naar voren. Lege blokken verdwijnen vanzelf.'),
    );
    for (const [groep, lijst] of BLOKGROEPEN) {
      const raster = maak('div', 'inst-raster');
      for (const [id, naam, uitleg] of lijst)
        raster.append(schakelaarRij(naam, inst.blokken[id] !== false, async (aan) => void (inst = await bewaar({ blokken: { [id]: aan } })), uitleg));
      blokken.append(maak('p', 'inst-label', groep), raster);
    }

    const standen = maak('section', 'inst-sectie');
    standen.append(
      maak('h3', 'lbl', 'OCHTEND EN AVOND'),
      maak('p', 'muted klein', 'In de ochtendstand staat je dag bovenaan. In de avondstand wordt het rustig: alleen de kamer, de camera en de knoppen, met wat er morgen is.'),
      periodeRij('Ochtendstand', 'Je agenda en wat belangrijk is groot bovenaan', inst.standen.ochtend, async (p) => void (inst = await bewaar({ standen: { ...inst.standen, ochtend: p } }))),
      periodeRij('Avondstand', 'Rust: geen mail en agenda, wel morgen in één regel', inst.standen.avond, async (p) => void (inst = await bewaar({ standen: { ...inst.standen, avond: p } }))),
    );

    const start = maak('section', 'inst-sectie');
    start.append(maak('h3', 'lbl', 'STARTSCHERM'));
    for (const [soort, naam] of [['breed', 'Op de pc'], ['smal', 'Op de telefoon']] as const) {
      const rij = maak('div', 'lamp');
      const segment = maak('div', 'segment inst-keuze');
      const knoppen = (['thuis', 'overzicht'] as const).map((scherm) => {
        const k = knop(scherm === 'thuis' ? 'Thuis' : 'Overzicht', '');
        k.setAttribute('aria-pressed', String(inst.start[soort] === scherm));
        k.addEventListener('click', async () => {
          inst = await bewaar({ start: { ...inst.start, [soort]: scherm } });
          knoppen.forEach((b) => b.setAttribute('aria-pressed', String(b === k)));
        });
        return k;
      });
      segment.append(...knoppen);
      rij.append(maak('div', 'lamp-info', naam), segment);
      start.append(rij);
    }

    const data = maak('section', 'inst-sectie');
    data.append(
      maak('h3', 'lbl', 'BELANGRIJKE DATA'),
      maak('p', 'muted klein', 'Een deadline heeft alleen een einddatum. Vul ook "van" in voor een periode, zoals een stage.'),
    );
    const regels = maak('div');
    const regel = (d?: Datum) => {
      const r = maak('div', 'inst-datum');
      r.dataset.id = d?.id ?? '';
      const titel = maak('input', 'inst-veld');
      titel.placeholder = 'Naam';
      titel.maxLength = 80;
      titel.value = d?.titel ?? '';
      titel.setAttribute('aria-label', 'Naam');
      const van = maak('input', 'inst-veld');
      van.type = 'date';
      van.value = d?.van ?? '';
      van.setAttribute('aria-label', 'Van (optioneel)');
      const tot = maak('input', 'inst-veld');
      tot.type = 'date';
      tot.value = d?.datum ?? '';
      tot.setAttribute('aria-label', 'Datum of t/m');
      const weg = knop('×', 'knop zacht');
      weg.setAttribute('aria-label', 'Regel verwijderen');
      weg.addEventListener('click', () => r.remove());
      r.append(titel, van, tot, weg);
      return r;
    };
    const kop = maak('div', 'inst-datum inst-kop');
    kop.append(maak('span', 'klein muted', 'Naam'), maak('span', 'klein muted', 'Van (optioneel)'), maak('span', 'klein muted', 'Datum / t/m'), maak('span'));
    regels.append(kop, ...inst.belangrijk.map(regel));
    const toevoegen = knop('Regel toevoegen', 'knop zacht');
    toevoegen.addEventListener('click', () => regels.append(regel()));
    const opslaan = knop('Opslaan');
    const melding = maak('p', 'klein muted');
    melding.setAttribute('role', 'status');
    opslaan.addEventListener('click', async () => {
      const lijst = [...regels.querySelectorAll<HTMLElement>('.inst-datum[data-id]')]
        .map((r) => {
          const [titel, van, tot] = r.querySelectorAll('input');
          return { id: r.dataset.id || undefined, titel: titel.value, van: van.value || null, datum: tot.value };
        })
        .filter((d) => d.titel.trim() || d.datum);
      try {
        inst = await bewaar({ belangrijk: lijst as Datum[] });
        regels.replaceChildren(kop, ...inst.belangrijk.map(regel));
        melding.textContent = 'Opgeslagen.';
      } catch (fout) {
        melding.textContent = (fout as Error).message;
      }
    });
    const rij = maak('div', 'inst-rij');
    rij.append(toevoegen, opslaan);
    data.append(regels, rij, melding);

    // Vertrekhulp: een vaste reistijd, en per plek een eigen tijd. De plek wordt herkend in de titel of de locatie.
    const vertrek = maak('section', 'inst-sectie');
    vertrek.append(
      maak('h3', 'lbl', 'VERTREKHULP'),
      maak('p', 'muted klein', 'Atlas rekent terug vanaf je volgende afspraak met een locatie. Zet per plek een eigen reistijd, één per regel, zoals “Xafax = 25”. Die naam mag in de titel of de locatie van de afspraak staan.'),
    );
    const reistijdRij = maak('div', 'lamp');
    const reistijd = maak('input', 'inst-veld getal-veld');
    reistijd.type = 'number';
    reistijd.min = '0';
    reistijd.max = '300';
    reistijd.value = String(inst.vertrek.reistijd);
    reistijd.setAttribute('aria-label', 'Standaard reistijd in minuten');
    const tijdVak = maak('div', 'inst-tijden');
    tijdVak.append(reistijd, maak('span', 'muted klein', 'min'));
    reistijdRij.append(maak('div', 'lamp-info', 'Standaard reistijd'), tijdVak);
    const plekken = maak('textarea', 'inst-veld inst-tekstvak');
    plekken.rows = 3;
    plekken.placeholder = 'Xafax = 25\nSportschool = 10';
    plekken.value = inst.vertrek.plekken.map((p) => `${p.naam} = ${p.minuten}`).join('\n');
    plekken.setAttribute('aria-label', 'Plekken met reistijd');
    const vertrekOpslaan = knop('Opslaan');
    const vertrekMelding = maak('p', 'klein muted');
    vertrekMelding.setAttribute('role', 'status');
    vertrekOpslaan.addEventListener('click', async () => {
      const lijst = plekken.value
        .split('\n')
        .map((r) => r.match(/^(.+?)\s*[=:]\s*(\d+)\s*(min.*)?$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ naam: m[1].trim(), minuten: Number(m[2]) }));
      try {
        inst = await bewaar({ vertrek: { reistijd: Number(reistijd.value) || 0, plekken: lijst } });
        plekken.value = inst.vertrek.plekken.map((p) => `${p.naam} = ${p.minuten}`).join('\n');
        vertrekMelding.textContent = 'Opgeslagen.';
      } catch (fout) {
        vertrekMelding.textContent = (fout as Error).message;
      }
    });
    vertrek.append(reistijdRij, plekken, vertrekOpslaan, vertrekMelding);

    return {
      scherm: [blokken, standen, start],
      data: [data, vertrek],
      meldingen: [await tekenMeldingen(inst, (nieuw) => (inst = nieuw)), await tekenWeg(inst, (nieuw) => (inst = nieuw))],
      knoppen: [await tekenSnelkoppelingen(inst)],
    };
  }

  /** Thuis en weg: via de personen in Home Assistant. */
  async function tekenWeg(inst: Instellingen, zet: (inst: Instellingen) => void) {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(
      maak('h3', 'lbl', 'THUIS EN WEG'),
      maak('p', 'muted klein', 'Atlas weet of je thuis bent via de personen in Home Assistant (de app op je telefoon). De meldingen gaan naar de telefoon die hierboven gekozen is.'),
    );
    const status = maak('p', 'klein muted');
    try {
      const a = (await (await fetch('/api/aanwezig')).json()) as { personen: { naam: string; thuis: boolean }[] };
      status.textContent = a.personen.length
        ? `Gevonden: ${a.personen.map((p) => `${p.naam} (${p.thuis ? 'thuis' : 'weg'})`).join(', ')}`
        : 'Nog geen personen gevonden in Home Assistant. Voeg je telefoon toe aan een persoon onder Instellingen › Personen.';
    } catch {
      status.textContent = '';
    }
    const lokaal = { ...inst.weg };
    const bewaarW = async (deel: Partial<Instellingen['weg']>) => {
      Object.assign(lokaal, deel);
      zet(await bewaar({ weg: deel }));
    };
    sectie.append(
      status,
      schakelaarRij('Thuis en weg', lokaal.aan, (aan) => bewaarW({ aan }), 'Hoofdschakelaar voor de twee hieronder'),
      schakelaarRij('“Alles uit?” als je weggaat', lokaal.allesUit, (aan) => bewaarW({ allesUit: aan }), 'Eén melding met een knop, alleen als er nog lampen branden'),
      schakelaarRij('Camera’s alleen als je weg bent', lokaal.alleenWeg, (aan) => bewaarW({ alleenWeg: aan }), 'Op de telefoon; de pc meldt altijd'),
    );
    return sectie;
  }

  /** De knoppen onderin: volgorde en weghalen. Toevoegen gaat met de punaise bij Apparaten. */
  async function tekenSnelkoppelingen(inst: Instellingen) {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'KNOPPEN ONDERIN'));
    let namen = new Map<string, string>();
    try {
      const data = (await (await fetch('/api/apparaten')).json()) as { ruimtes: { apparaten: { id: string; naam: string }[] }[]; overig: { id: string; naam: string }[] };
      namen = new Map([...data.ruimtes.flatMap((r) => r.apparaten), ...data.overig].map((a) => [a.id, a.naam]));
    } catch {
      // Dan de technische namen.
    }
    const lijst = maak('div');
    const teken = () => {
      const ids = inst.snelkoppelingen;
      if (!ids.length) {
        lijst.replaceChildren(maak('p', 'muted klein', 'Nu staan alle scènes onderin. Kies zelf knoppen met de punaise bij een lamp, schakelaar of scène in Apparaten.'));
        return;
      }
      lijst.replaceChildren(
        ...ids.map((id, i) => {
          const rij = maak('div', 'lamp');
          rij.append(maak('div', 'lamp-info', namen.get(id) ?? id));
          const knoppen = maak('div', 'inst-rij');
          const zet = async (nieuw: string[]) => {
            inst = await bewaar({ snelkoppelingen: nieuw });
            teken();
          };
          const omhoog = knop('↑', 'knop zacht');
          omhoog.setAttribute('aria-label', `${namen.get(id) ?? id} naar links`);
          omhoog.disabled = i === 0;
          omhoog.addEventListener('click', () => zet(ids.map((x, j) => (j === i - 1 ? id : j === i ? ids[i - 1] : x))));
          const weg = knop('×', 'knop zacht');
          weg.setAttribute('aria-label', `${namen.get(id) ?? id} weghalen`);
          weg.addEventListener('click', () => zet(ids.filter((x) => x !== id)));
          knoppen.append(omhoog, weg);
          rij.append(knoppen);
          return rij;
        }),
      );
    };
    teken();
    sectie.append(lijst);
    return sectie;
  }

  async function tekenMeldingen(inst: Instellingen, zet: (inst: Instellingen) => void) {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'MELDINGEN'));
    let opties: Opties;
    try {
      opties = await (await fetch('/api/meldingen/opties')).json();
    } catch {
      sectie.append(maak('p', 'muted', 'De server is niet bereikbaar.'));
      return sectie;
    }
    // Eigen kopie die meteen bijgewerkt wordt, zodat snel na elkaar klikken elkaar niet overschrijft.
    const lokaal = { ...inst.meldingen };
    const m = () => lokaal;
    const bewaarM = async (deel: Partial<Meldingen>) => {
      const vorig = { ...lokaal };
      Object.assign(lokaal, deel);
      try {
        zet(await bewaar({ meldingen: deel }));
      } catch (fout) {
        Object.assign(lokaal, vorig);
        throw fout;
      }
    };

    if (!opties.frigate.ingesteld)
      sectie.append(maak('p', 'muted klein', 'Atlas zoekt Frigate op poort 5000 van je server, maar heeft hem nog niet gevonden. Staat Frigate op een ander adres, vul dan FRIGATE_URL in bij de app Atlas in ZimaOS.'));
    else if (!opties.frigate.bereikbaar) sectie.append(maak('p', 'klein warm', 'Frigate reageert niet. Klopt FRIGATE_URL, en staat poort 5000 open?'));

    sectie.append(
      schakelaarRij('Op de pc', m().pc, (aan) => bewaarM({ pc: aan })),
      schakelaarRij('Op de telefoon', m().telefoon, (aan) => bewaarM({ telefoon: aan })),
      periodeRij('Stille uren', 'Geen meldingen; wat er was staat ’s ochtends in Vandaag gezien', m().stil, (p) => bewaarM({ stil: p })),
    );

    const toestelRij = maak('div', 'lamp');
    const keuze = maak('select', 'kamer-keuze');
    keuze.setAttribute('aria-label', 'Telefoon voor meldingen');
    keuze.append(Object.assign(maak('option', undefined, opties.toestellen.length ? 'Kies je telefoon' : 'Geen telefoon gevonden'), { value: '' }));
    for (const t of opties.toestellen) keuze.append(Object.assign(maak('option', undefined, t.naam), { value: t.id }));
    keuze.value = m().toestel ?? '';
    keuze.addEventListener('change', () => bewaarM({ toestel: keuze.value || null }));
    toestelRij.append(maak('div', 'lamp-info', 'Telefoon'), keuze);
    sectie.append(toestelRij);

    sectie.append(maak('p', 'inst-label', 'Waarvoor'));
    const soorten = maak('div', 'segment inst-keuze inst-chips');
    for (const soort of opties.soorten) {
      const k = knop(SOORTNAMEN[soort] ?? soort, '');
      k.setAttribute('aria-pressed', String(m().soorten.includes(soort)));
      k.addEventListener('click', async () => {
        const aan = !m().soorten.includes(soort);
        k.setAttribute('aria-pressed', String(aan));
        await bewaarM({ soorten: aan ? [...m().soorten, soort] : m().soorten.filter((s) => s !== soort) }).catch(() => k.setAttribute('aria-pressed', String(!aan)));
      });
      soorten.append(k);
    }
    sectie.append(soorten);

    if (opties.cameras.length) {
      sectie.append(maak('p', 'inst-label', "Camera's"));
      for (const camera of opties.cameras)
        sectie.append(
          schakelaarRij(cameraNaam(camera), !m().camerasUit.includes(camera), (aan) =>
            bewaarM({ camerasUit: aan ? m().camerasUit.filter((c) => c !== camera) : [...m().camerasUit, camera] }),
          ),
        );
    }

    if (opties.zones.length) {
      sectie.append(
        maak('p', 'inst-label', 'Alleen in deze zones'),
        maak('p', 'muted klein', 'Kies je zones bij een camera, dan krijg je alleen een melding als iemand daarin komt (bijvoorbeeld de oprit en niet de stoep).'),
      );
      for (const zone of opties.zones) {
        const [camera, naam] = zone.split('/');
        sectie.append(
          schakelaarRij(`${cameraNaam(camera)} · ${cameraNaam(naam)}`, m().zones.includes(zone), (aan) =>
            bewaarM({ zones: aan ? [...m().zones, zone] : m().zones.filter((z) => z !== zone) }),
          ),
        );
      }
    }

    sectie.append(maak('p', 'inst-label', 'Gezichtsherkenning'));
    if (opties.gezichten.length) {
      sectie.append(maak('p', 'muted klein', 'Herkent Frigate iemand, dan staat de naam in de melding. Wie je hier aanzet, geeft geen melding, bijvoorbeeld als je zelf thuiskomt.'));
      for (const naam of opties.gezichten)
        sectie.append(
          schakelaarRij(`Geen melding voor ${naam}`, m().bekenden.some((b) => b.toLowerCase() === naam.toLowerCase()), (aan) =>
            bewaarM({ bekenden: aan ? [...m().bekenden, naam] : m().bekenden.filter((b) => b.toLowerCase() !== naam.toLowerCase()) }),
          ),
        );
    } else
      sectie.append(
        maak(
          'p',
          'muted klein',
          'Nog geen gezichten gevonden. Zet in Frigate (0.16 of nieuwer) face_recognition aan en voeg in de Face Library een paar foto’s per persoon toe. Daarna verschijnen de namen hier.',
        ),
      );

    sectie.append(
      maak(
        'p',
        'muted klein',
        'Wil je dat Frigate fietsen en auto’s helemaal niet meer volgt? Zet in de Frigate-config onder objects › track alleen person (en eventueel dog of cat).',
      ),
    );

    const wachtRij = maak('div', 'lamp');
    const wacht = maak('select', 'kamer-keuze');
    wacht.setAttribute('aria-label', 'Stilte na een melding');
    for (const minuten of [0, 1, 2, 5, 10, 30])
      wacht.append(Object.assign(maak('option', undefined, minuten === 0 ? 'Geen' : `${minuten} min`), { value: String(minuten) }));
    wacht.value = String(m().wachttijd);
    wacht.addEventListener('change', () => bewaarM({ wachttijd: Number(wacht.value) }));
    wachtRij.append(maak('div', 'lamp-info', 'Stilte per camera na een melding'), wacht);
    sectie.append(wachtRij);

    const test = knop('Testmelding', 'knop zacht');
    const melding = maak('p', 'klein muted');
    melding.setAttribute('role', 'status');
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        const { telefoon } = await stuur('/api/meldingen/test', 'POST');
        melding.textContent = `Verstuurd. ${telefoon ?? ''}`.trim();
      } catch (fout) {
        melding.textContent = (fout as Error).message;
      }
      test.disabled = false;
    });
    sectie.append(test, melding);
    return sectie;
  }

  /** Wat Atlas allemaal vindt: groen is goed, warm is iets om naar te kijken, grijs staat uit. */
  async function tekenStatus() {
    const sectie = maak('section', 'inst-sectie');
    const kop = maak('div', 'kop');
    const opnieuw = knop('Opnieuw kijken', 'knop zacht');
    kop.append(maak('h3', 'lbl', 'WAT ATLAS VINDT'), opnieuw);
    const lijst = maak('ul', 'status-lijst');
    sectie.append(kop, lijst);
    const vul = async () => {
      lijst.replaceChildren(maak('li', 'laden'), maak('li', 'laden kort'));
      opnieuw.disabled = true;
      try {
        const data = (await (await fetch('/api/status')).json()) as { lijst: { naam: string; staat: string; tekst: string }[] };
        lijst.replaceChildren(
          ...data.lijst.map((c) => {
            // De staat als data-attribuut: de klasse "uit" verbergt elk blok.
            const rij = maak('li', 'status-rij');
            rij.dataset.staat = c.staat;
            const tekst = maak('div', 'status-tekst');
            tekst.append(maak('strong', undefined, c.naam), maak('span', 'muted klein', c.tekst));
            rij.append(maak('span', 'status-stip'), tekst);
            rij.setAttribute('aria-label', `${c.naam}: ${c.staat === 'goed' ? 'werkt' : c.staat === 'uit' ? 'staat uit' : 'let op'}. ${c.tekst}`);
            return rij;
          }),
        );
      } catch {
        lijst.replaceChildren(maak('li', 'muted klein', 'De server is niet bereikbaar.'));
      }
      opnieuw.disabled = false;
    };
    opnieuw.addEventListener('click', vul);
    void vul();
    return sectie;
  }

  async function tekenVersie() {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'ATLAS BIJWERKEN'));
    let v: { huidig: string; nieuwste: string | null; nieuw: boolean };
    try {
      v = await (await fetch('/api/versie')).json();
    } catch {
      return sectie;
    }
    sectie.append(
      maak(
        'p',
        v.nieuw ? 'klein warm' : 'muted klein',
        v.nieuw ? `Er staat een nieuwe versie klaar (${v.nieuwste}). Je hebt nu ${v.huidig}.` : `Je hebt de nieuwste versie (${v.huidig}).`,
      ),
    );
    if (v.nieuw) {
      sectie.append(maak('p', 'muted klein', 'Plak dit in de terminal van ZimaOS. Je instellingen blijven bewaard.'));
      const opdracht = maak('code', 'inst-code', BIJWERKEN);
      const kopieer = knop('Kopiëren', 'knop zacht');
      kopieer.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(BIJWERKEN);
          kopieer.textContent = 'Gekopieerd';
        } catch {
          getSelection()?.selectAllChildren(opdracht);
        }
      });
      sectie.append(opdracht, kopieer);
    }
    return sectie;
  }

  // Tabbladen in plaats van één lange lijst. Het laatst gekozen tabblad blijft open bij de volgende keer.
  const TABS = [
    ['scherm', 'Scherm'],
    ['data', 'Data'],
    ['meldingen', 'Meldingen'],
    ['knoppen', 'Knoppen'],
    ['koppelingen', 'Koppelingen'],
  ] as const;
  type Tab = (typeof TABS)[number][0];
  let tab: Tab = 'scherm';
  try {
    const bewaard = localStorage.getItem('atlas-inst-tab');
    if (TABS.some(([id]) => id === bewaard)) tab = bewaard as Tab;
  } catch {
    // Geen opslag in de browser, dan begint het bij Scherm.
  }

  async function teken() {
    const google = maak('div');
    const [delen, versie] = await Promise.all([tekenAlgemeen(), tekenVersie()]);
    if (!delen) {
      inhoud.replaceChildren(maak('p', 'muted', 'De server is niet bereikbaar.'));
      return;
    }
    const nieuw = versie.childElementCount > 2;
    const panelen: Record<Tab, HTMLElement[]> = { ...delen, koppelingen: [await tekenStatus(), google, ...(nieuw ? [] : [versie])] };
    const balk = maak('div', 'inst-tabs');
    balk.setAttribute('role', 'tablist');
    balk.setAttribute('aria-label', 'Onderdelen van de instellingen');
    const vak = maak('div', 'inst-paneel');
    vak.setAttribute('role', 'tabpanel');
    const knoppen = TABS.map(([id, naam]) => {
      const k = knop(naam, 'inst-tab');
      k.setAttribute('role', 'tab');
      k.id = `inst-tab-${id}`;
      k.addEventListener('click', () => kies(id));
      k.addEventListener('keydown', (e) => {
        const stap = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!stap) return;
        const volgende = TABS[(TABS.findIndex(([t]) => t === id) + stap + TABS.length) % TABS.length][0];
        kies(volgende);
        document.getElementById(`inst-tab-${volgende}`)?.focus();
      });
      return k;
    });
    function kies(id: Tab) {
      tab = id;
      try {
        localStorage.setItem('atlas-inst-tab', id);
      } catch {
        // Niet erg.
      }
      knoppen.forEach((k, i) => {
        const gekozen = TABS[i][0] === id;
        k.setAttribute('aria-selected', String(gekozen));
        k.tabIndex = gekozen ? 0 : -1;
      });
      vak.setAttribute('aria-labelledby', `inst-tab-${id}`);
      vak.replaceChildren(...panelen[id]);
      vak.scrollTop = 0;
    }
    balk.append(...knoppen);
    // Staat er een nieuwe versie klaar, dan staat die bovenaan, los van de tabbladen.
    inhoud.replaceChildren(...(nieuw ? [versie] : []), balk, vak);
    kies(tab);
    await tekenGoogle(google);
  }

  async function tekenGoogle(plek: HTMLElement) {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'GOOGLE AGENDA EN GMAIL'));
    plek.replaceChildren(sectie);
    let status: GoogleStatus;
    try {
      status = await (await fetch('/api/google')).json();
    } catch {
      sectie.append(maak('p', 'muted', 'De server is niet bereikbaar.'));
      return;
    }

    if (!status.ingesteld) {
      sectie.append(
        maak('p', 'muted', 'Nog niet ingesteld. Vul GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET in bij de app Atlas in ZimaOS. De stappen staan in de README.'),
      );
      return;
    }

    if (!status.gekoppeld) {
      const uitleg = maak('ol', 'inst-stappen');
      for (const regel of [
        'Klik op "Open Google" en geef toestemming.',
        'Je komt daarna op een pagina die niet laadt. Dat hoort zo.',
        'Kopieer het adres uit de adresbalk en plak het hieronder.',
      ])
        uitleg.append(maak('li', undefined, regel));
      const open = knop('Open Google');
      const link = maak('a', 'klein muted');
      link.target = '_blank';
      link.rel = 'noopener';
      const veld = maak('input', 'inst-veld');
      veld.placeholder = 'http://127.0.0.1:8790/google?state=…&code=…';
      veld.setAttribute('aria-label', 'Adres uit de adresbalk');
      const koppel = knop('Koppelen');
      const melding = maak('p', 'klein muted');
      melding.setAttribute('role', 'status');

      open.addEventListener('click', async () => {
        try {
          const { adres } = await stuur('/api/google/start', 'POST');
          link.href = adres;
          link.textContent = 'Opent er niets? Klik dan hier, of open Atlas in je browser en koppel daar.';
          window.open(adres, '_blank', 'noopener');
        } catch (fout) {
          melding.textContent = (fout as Error).message;
        }
      });
      koppel.addEventListener('click', async () => {
        koppel.disabled = true;
        melding.textContent = 'Bezig met koppelen…';
        try {
          await stuur('/api/google/koppel', 'POST', { adres: veld.value });
          naVerandering();
          await tekenGoogle(plek);
        } catch (fout) {
          melding.textContent = (fout as Error).message;
          koppel.disabled = false;
        }
      });
      const rij = maak('div', 'inst-rij');
      rij.append(veld, koppel);
      sectie.append(uitleg, open, link, rij, melding);
      return;
    }

    sectie.append(maak('p', 'muted klein', "Gekoppeld. Kies welke agenda's Atlas laat zien."));
    for (const agenda of status.agendas) {
      const rij = maak('div', 'lamp');
      const naam = maak('div', 'lamp-info');
      const stip = maak('span', 'agenda-stip');
      stip.style.background = agenda.kleur ?? 'var(--ijs)';
      naam.append(stip, maak('span', undefined, agenda.naam));
      const schakelaar = knop('', 'schakelaar');
      schakelaar.setAttribute('role', 'switch');
      schakelaar.setAttribute('aria-checked', String(agenda.aan));
      schakelaar.setAttribute('aria-label', `${agenda.naam} tonen`);
      schakelaar.addEventListener('click', async () => {
        agenda.aan = !agenda.aan;
        schakelaar.setAttribute('aria-checked', String(agenda.aan));
        try {
          await stuur('/api/google/agenda', 'POST', { id: agenda.id, aan: agenda.aan });
          naVerandering();
        } catch {
          agenda.aan = !agenda.aan;
          schakelaar.setAttribute('aria-checked', String(agenda.aan));
        }
      });
      rij.append(naam, schakelaar);
      sectie.append(rij);
    }
    const ontkoppel = knop('Google ontkoppelen', 'knop zacht');
    ontkoppel.addEventListener('click', async () => {
      await stuur('/api/google', 'DELETE');
      naVerandering();
      await tekenGoogle(plek);
    });
    sectie.append(ontkoppel);
  }

  document.getElementById('tandwiel')!.addEventListener('click', () => {
    venster.showModal();
    teken();
  });
  document.getElementById('instellingen-sluit')!.addEventListener('click', () => venster.close());
  // Klikken naast het venster sluit het ook.
  venster.addEventListener('click', (e) => e.target === venster && venster.close());
}
