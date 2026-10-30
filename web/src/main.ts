import './styles.css';
import { lagen, type Ruimte } from './huis';
import { instellingen, type Instellingen } from './instellingen';
import { lampSchuiven, schuiftNu, type LampDelen } from './lamp';
import { maakApparaten, maakCameras } from './paginas';
import { meldFout, post } from './melding';
import { begroeting, startGlans } from './glans';
import { tekenLucht } from './lucht';
import { laadEnergie } from './energie';
import { kanSpraak, startOpdracht } from './opdracht';

type Overzicht = {
  voorbeeld: boolean;
  weer: { omschrijving: string; temperatuur: number };
  agenda: { tijd: string; titel: string; detail: string; kleur?: string | null }[];
  morgen: string;
  mail: { van: string; onderwerp: string; stukje?: string; tijd?: string | null; link?: string }[];
  mailAantal?: number;
  agendaFout?: boolean;
  mailFout?: boolean;
  google?: { ingesteld: boolean; gekoppeld: boolean };
};
type Scherm = Instellingen['start']['breed'] | 'apparaten' | 'cameras';
type Apparaat = {
  id: string;
  naam: string;
  soort: string;
  tekst: string;
  aan: boolean | null;
  bediening: 'schakel' | 'start' | null;
  bereikbaar: boolean;
  lamp?: LampDelen;
};
type Lamp = { id: string; naam: string; aan: boolean; bereikbaar: boolean } & LampDelen;
type Kamer = { id: string; naam: string; verdieping: string | null; temperatuur: number | null; lampen: Lamp[] };
type Huis = {
  bron: 'home-assistant' | 'voorbeeld';
  kamers: Kamer[];
  losseLampen: Lamp[];
  cameras: { id: string; naam: string; kamer: string | null; beweging: string | null }[];
  scenes: { id: string; naam: string }[];
  weer: { omschrijving: string; temperatuur: number | null } | null;
  binnen: number | null;
};

const LOS = '__los';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const staat = {
  verdieping: 'alle',
  modus: '3d' as '2d' | '3d' | 'vrij',
  /** Gekozen ruimte op de plattegrond, of null als er een ruimte uit de keuzelijst is gekozen. */
  gekozen: 'bureau' as string | null,
  /** Gekozen ruimte in Home Assistant. */
  kamer: null as string | null,
  camera: 0,
  huis: null as Huis | null,
  overzicht: null as Overzicht | null,
  huisFout: false,
  inst: null as Instellingen | null,
  /** Alle apparaten uit Home Assistant, voor de favorieten en de knoppen onderin. */
  apparaten: null as Apparaat[] | null,
  scherm: 'thuis' as Scherm,
  /** Het huis is uitgezet, maar tijdelijk naar voren gehaald met de huisknop. */
  huisVoor: false,
  /** Lampen en apparaten waarvan een opdracht onderweg is; hun schakelaar staat dan even op wachten. */
  bezig: new Set<string>(),
  vertrek: null as Vertrek | null,
  regen: null as Regen | null,
  afval: [] as Afval[],
};

type Vertrek = { titel: string; plek: string | null; begin: string; om: string; reistijd: number };
type Regen = { tekst: string; nu: boolean; komt: boolean };
type Afval = { id: string; naam: string; datum: string };

function tekst(el: HTMLElement, waarde: string) {
  el.textContent = waarde;
}

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

const graden = (t: number) => `${t.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} °C`;
const uur = (iso: string) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

// Klok en dagboog
const datumFormaat = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
function tikKlok() {
  const nu = new Date();
  tekst($('tijd'), nu.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }));
  tekst($('datum'), `${begroeting()} · ${datumFormaat.format(nu)}`);
  const deel = (nu.getHours() * 60 + nu.getMinutes()) / 1440;
  $('dagboog').setAttribute('stroke-dasharray', `${Math.round(478 * deel)} 478`);
}

// Koppeling tussen de plattegrond en de ruimtes in Home Assistant, op naam.
const gewoon = (naam: string) => naam.toLowerCase().replace(/[^a-z0-9]/g, '');
function kamerBij(ruimte: Ruimte): Kamer | undefined {
  const namen = [ruimte.naam, ...(ruimte.ha ?? [])].map(gewoon);
  return staat.huis?.kamers.find((k) => namen.includes(gewoon(k.naam)));
}
function ruimteBij(kamerId: string): Ruimte | undefined {
  return lagen.flatMap((l) => l.ruimtes).find((r) => kamerBij(r)?.id === kamerId);
}
const lichtAan = (r: Ruimte) => !!kamerBij(r)?.lampen.some((l) => l.aan);

// Het draaibare 3D-model (three.js) laadt pas als je het voor het eerst kiest.
let huis3d: { zet: (s: { gekozen: string | null; verdieping: string }) => void; start: () => void; stop: () => void } | null = null;
let huis3dLaden: Promise<void> | null = null;
const huis3dVak = maak('div', 'huis3d');
function tekenHuis3d() {
  const huis = $('huis');
  huis.classList.add('vrij');
  if (huis.firstChild !== huis3dVak) huis.replaceChildren(huis3dVak);
  const zet = () => {
    huis3d!.zet({ gekozen: staat.gekozen, verdieping: staat.verdieping });
    huis3d!.start();
  };
  if (huis3d) return zet();
  huis3dLaden ??= import('./huis3d')
    .then(({ maakHuis3d }) => {
      huis3d = maakHuis3d(huis3dVak, {
        kies: (r) => {
          staat.gekozen = r.id;
          staat.kamer = kamerBij(r)?.id ?? null;
          tekenAlles();
        },
        info: (r) => {
          const k = kamerBij(r);
          return { aan: lichtAan(r), temp: k?.temperatuur != null ? graden(k.temperatuur) : '' };
        },
      });
      if (staat.modus === 'vrij') zet();
    })
    .catch(() => {
      meldFout('Het 3D-model laden lukte niet');
      staat.modus = '3d';
      tekenAlles();
    });
}

function tekenHuis() {
  const huis = $('huis');
  if (staat.modus === 'vrij') return tekenHuis3d();
  huis.classList.remove('vrij');
  huis3d?.stop();
  const driedee = staat.modus === '3d';
  // In 3D blijft het hele huis staan; een gekozen verdieping komt in focus en de rest blijft vaag zichtbaar. In 2D zie je
  // alleen de gekozen verdieping (of de begane grond bij Alles).
  const getoond = !driedee && staat.verdieping === 'alle' ? 'bg' : staat.verdieping;
  const gestapeld = driedee;
  const focus = driedee && staat.verdieping !== 'alle' ? lagen.findIndex((l) => l.id === staat.verdieping) : -1;

  const gebouw = maak('div', 'gebouw' + (driedee ? '' : ' plat') + (focus >= 0 ? ' met-focus' : ''));
  gebouw.style.transform = !driedee
    ? 'scale(0.92)'
    : focus >= 0
      ? // Het huis schuift zo dat de gekozen verdieping ongeveer in het midden staat.
        `translateY(${Math.round(70 + (lagen[focus].z - 160) * 0.7)}px) rotateX(58deg) rotateZ(-38deg) scale(0.84)`
      : 'translateY(110px) rotateX(60deg) rotateZ(-38deg) scale(0.78)';

  for (const [i, laag] of lagen.entries()) {
    if (!gestapeld && getoond !== laag.id) continue;
    const vlak = maak('div', 'laag' + (focus < 0 ? '' : i === focus ? ' focus' : ' vervaagd'));
    vlak.style.height = `${laag.hoogte}%`;
    // Verdiepingen boven de gekozen schuiven wat omhoog, zodat je van bovenaf goed in de gekozen verdieping kijkt.
    const z = gestapeld ? laag.z + (focus >= 0 && i > focus ? 90 : 0) : 0;
    vlak.style.transform = `translateZ(${z}px)`;
    vlak.style.boxShadow = i === focus
      ? '0 0 0 2px #D6EDFF, 0 0 40px rgba(111,168,255,0.35), 0 50px 80px -20px rgba(0,0,0,0.7)'
      : gestapeld
        ? '0 0 0 2px #C7CED8, 0 50px 80px -20px rgba(0,0,0,0.7)'
        : '0 0 0 4px #C7CED8, 0 60px 90px -10px rgba(0,0,0,0.85)';
    // Op de naam van een verdieping klikken gaat naar die verdieping, en nog een keer klikken terug naar alles.
    const naam = maak('button', 'lbl laag-naam', laag.label);
    naam.type = 'button';
    naam.addEventListener('click', () => kiesVerdieping(staat.verdieping === laag.id ? 'alle' : laag.id));
    if (staat.verdieping === laag.id) naam.style.color = '#D6EDFF';
    vlak.append(naam);

    for (const r of laag.ruimtes) {
      const kamer = kamerBij(r);
      const aan = lichtAan(r);
      const knop = maak('button', 'ruimte' + (aan ? ' licht' : ''));
      knop.type = 'button';
      Object.assign(knop.style, { left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%` });
      knop.setAttribute('aria-pressed', String(r.id === staat.gekozen));
      knop.setAttribute('aria-label', `${laag.naam}, ${r.naam}${aan ? ', licht aan' : ''}`);
      const label = maak('span');
      label.style.cssText = 'display:flex;flex-direction:column;gap:2px';
      label.append(maak('span', 'naam', r.naam), maak('span', 'temp', kamer?.temperatuur != null ? graden(kamer.temperatuur) : ''));
      knop.append(label);
      if (driedee) {
        const m = laag.muur;
        const muren: [string, string][] = [
          [`left:0;top:0;width:100%;height:${m}px`, 'top'],
          [`left:0;top:100%;width:100%;height:${m}px`, 'top'],
          [`left:0;top:0;width:${m}px;height:100%`, 'left'],
          [`left:100%;top:0;width:${m}px;height:100%`, 'left'],
        ];
        for (const [plek, as] of muren) {
          const muur = maak('span', 'muur');
          muur.setAttribute('aria-hidden', 'true');
          muur.style.cssText = `${plek};transform-origin:${as};transform:${as === 'top' ? 'rotateX(-90deg)' : 'rotateY(-90deg)'}`;
          knop.append(muur);
        }
      }
      knop.addEventListener('click', () => {
        staat.gekozen = r.id;
        staat.kamer = kamer?.id ?? null;
        tekenAlles();
      });
      vlak.append(knop);
    }
    gebouw.append(vlak);
  }
  huis.replaceChildren(gebouw);
}

// Verdiepingen van boven naar beneden, zoals je ze in het huis ziet. Scrollen boven het huis loopt deze lijst af.
const VERDIEPINGEN = ['alle', ...[...lagen].reverse().map((l) => l.id)];
function kiesVerdieping(id: string) {
  staat.verdieping = id;
  tekenAlles();
}

function tekenKnoppen() {
  const opties = VERDIEPINGEN.map((id) => ({ id, naam: id === 'alle' ? 'Alles' : lagen.find((l) => l.id === id)!.naam }));
  $('verdiepingen').replaceChildren(
    ...opties.map((o) => {
      const knop = maak('button', 'rail-knop');
      knop.type = 'button';
      knop.setAttribute('aria-pressed', String(staat.verdieping === o.id));
      knop.append(maak('span', 'rail-stip'), maak('span', 'rail-naam', o.naam));
      knop.addEventListener('click', () => kiesVerdieping(o.id));
      return knop;
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((knop) => {
    knop.setAttribute('aria-pressed', String(knop.dataset.modus === staat.modus));
  });
}

async function zetLamp(lamp: Lamp, aan: boolean) {
  lamp.aan = aan; // meteen tonen, de volgende ronde van Home Assistant bevestigt het
  staat.bezig.add(lamp.id);
  tekenAlles();
  try {
    await post(`/api/lamp/${encodeURIComponent(lamp.id)}`, { aan });
  } catch (fout) {
    console.error('Lamp schakelen mislukt', fout);
    meldFout(`${lamp.naam} reageert niet`);
    lamp.aan = !aan;
  }
  staat.bezig.delete(lamp.id);
  tekenAlles();
  setTimeout(laadHuis, 600);
}

function lampRij(lamp: Lamp) {
  const rij = maak('div', 'lamp');
  const info = maak('div', 'lamp-info');
  const namen = maak('span');
  const status = !lamp.bereikbaar ? 'Niet bereikbaar' : lamp.aan ? (lamp.helderheid != null ? `Aan · ${lamp.helderheid}%` : 'Aan') : 'Uit';
  namen.append(lamp.naam, maak('small', undefined, status));
  info.append(namen);
  // Lampen krijgen een warme schakelaar; warm betekent in Atlas altijd "licht aan".
  const schakelaar = maak('button', 'schakelaar warm');
  schakelaar.type = 'button';
  schakelaar.setAttribute('role', 'switch');
  schakelaar.setAttribute('aria-checked', String(lamp.aan));
  schakelaar.setAttribute('aria-label', `${lamp.naam} ${lamp.aan ? 'uitzetten' : 'aanzetten'}`);
  schakelaar.setAttribute('aria-busy', String(staat.bezig.has(lamp.id)));
  schakelaar.disabled = !lamp.bereikbaar || staat.bezig.has(lamp.id);
  schakelaar.addEventListener('click', () => zetLamp(lamp, !lamp.aan));
  rij.append(info, schakelaar);
  const schuiven = lampSchuiven(lamp, () => setTimeout(laadHuis, 400));
  if (schuiven) rij.append(schuiven);
  return rij;
}

function tekenKamer() {
  const huis = staat.huis;
  const ruimte = lagen.flatMap((l) => l.ruimtes.map((r) => ({ ...r, laag: l.naam }))).find((r) => r.id === staat.gekozen);
  const kamer = staat.kamer && staat.kamer !== LOS ? huis?.kamers.find((k) => k.id === staat.kamer) : undefined;
  const los = staat.kamer === LOS;

  // Menu met alle ruimtes uit Home Assistant, zodat ook ruimtes buiten de plattegrond bereikbaar zijn. Een klik op een
  // kamer in het huis doet hetzelfde.
  const menu = $('kamer-menu');
  const opties = [
    ...(huis?.kamers ?? []).filter((k) => k.lampen.length || k.temperatuur != null).map((k) => [k.id, k.naam, k.verdieping ?? '']),
    ...(huis?.losseLampen.length ? [[LOS, 'Overige lampen', '']] : []),
  ];
  // Alleen opnieuw opbouwen als de ruimtes veranderen, anders klapt een open menu elke ronde dicht.
  const sleutel = JSON.stringify([opties, staat.kamer]);
  if (menu.dataset.sleutel !== sleutel) {
    menu.dataset.sleutel = sleutel;
    menu.replaceChildren(
      ...opties.map(([id, naam, verdieping]) => {
        const knop = maak('button', 'menu-knop');
        knop.type = 'button';
        knop.setAttribute('role', 'menuitemradio');
        knop.setAttribute('aria-checked', String(id === staat.kamer));
        knop.append(maak('span', undefined, naam), maak('span', 'muted klein', verdieping));
        knop.addEventListener('click', () => {
          menu.hidePopover();
          kiesKamer(id);
        });
        return knop;
      }),
    );
  }
  $('kamer-kies').hidden = opties.length < 2;

  const verdieping = kamer ? kamer.verdieping : los ? 'Huis' : ruimte?.laag;
  tekst($('kamer-label'), verdieping ?? 'Kamer');
  tekst($('kamer-naam'), los ? 'Overige lampen' : (kamer?.naam ?? ruimte?.naam ?? ''));
  tekst($('kamer-temp'), kamer?.temperatuur != null ? graden(kamer.temperatuur) : '');

  const lijst = $('lampen');
  const lampen = los ? (huis?.losseLampen ?? []) : (kamer?.lampen ?? []);
  if (!huis) {
    lijst.replaceChildren(...(staat.huisFout ? [maak('p', 'muted', 'Home Assistant is niet bereikbaar.')] : [maak('div', 'laden'), maak('div', 'laden')]));
  } else if (!kamer && !los) {
    lijst.replaceChildren(maak('p', 'muted', 'Deze ruimte is nog niet gekoppeld aan een ruimte in Home Assistant.'));
  } else if (lampen.length === 0) {
    lijst.replaceChildren(maak('p', 'muted', 'Hier zijn geen lampen.'));
  } else if (!(schuiftNu() && lijst.dataset.kamer === staat.kamer)) {
    // Niet opnieuw opbouwen terwijl er aan een schuifje getrokken wordt.
    lijst.dataset.kamer = staat.kamer ?? '';
    lijst.replaceChildren(...lampen.map(lampRij));
  }
}

function tekenHud() {
  const huis = staat.huis;
  const lampen = huis ? [...huis.kamers.flatMap((k) => k.lampen), ...huis.losseLampen] : [];
  const camera = huis?.cameras[0];
  const aan = lampen.filter((l) => l.aan).length;
  // Hoe meer lampen aan, hoe warmer de gloed onder het huis.
  document.querySelector<HTMLElement>('.app')!.style.setProperty('--licht', String(lampen.length ? aan / lampen.length : 0));
  $('hud').replaceChildren(
    ...(huis?.binnen != null ? [maak('span', 'hud-chip mono', `${huis.binnen.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}° binnen`)] : []),
    ...(lampen.length ? [maak('span', 'hud-chip mono' + (aan ? ' warm' : ''), `${aan}/${lampen.length} lampen`)] : []),
    ...(camera?.beweging ? [maak('span', 'hud-chip mono', `${camera.naam.toLowerCase()} ${uur(camera.beweging)}`)] : []),
  );
}

async function bedienApparaat(a: Apparaat, aan: boolean) {
  if (a.bediening === 'schakel') a.aan = aan; // meteen tonen
  staat.bezig.add(a.id);
  tekenFavorieten();
  tekenScenes();
  try {
    await post(`/api/apparaat/${encodeURIComponent(a.id)}`, { aan });
  } catch (fout) {
    console.error('Bedienen mislukt', fout);
    meldFout(`${a.naam} reageert niet`);
    if (a.bediening === 'schakel') a.aan = !aan;
  }
  staat.bezig.delete(a.id);
  tekenFavorieten();
  tekenScenes();
  setTimeout(() => {
    laadApparaten();
    laadHuis();
  }, 700);
}

/** Knop in het dock onderin. Een brandende lamp of aan staande schakelaar licht warm op. */
function dockKnop(naam: string, aan: boolean | null, klik: () => void, opties: { bereikbaar?: boolean; lamp?: boolean } = {}) {
  const knop = maak('button', 'dock-knop' + (aan ? ' aan' : ''));
  knop.type = 'button';
  if (opties.lamp) knop.append(maak('span', 'dock-lamp'));
  knop.append(naam);
  if (aan != null) knop.setAttribute('aria-pressed', String(aan));
  knop.disabled = opties.bereikbaar === false;
  knop.addEventListener('click', klik);
  return knop;
}

/** Laat even zien dat een scène of script gestart is. */
function flits(knop: HTMLElement) {
  knop.classList.add('gestart');
  setTimeout(() => knop.classList.remove('gestart'), 1200);
}

/** De knoppen onderin: zelf gekozen in Apparaten of het tandwiel, en anders alle scènes. */
function tekenScenes() {
  const gekozen = staat.inst?.snelkoppelingen ?? [];
  let knoppen: HTMLElement[];
  if (gekozen.length) {
    knoppen = gekozen
      .map((id) => staat.apparaten?.find((a) => a.id === id))
      .filter((a): a is Apparaat => !!a)
      .map((a) => {
        const knop = dockKnop(a.naam, a.bediening === 'schakel' ? !!a.aan : null, () => {
          if (a.bediening === 'start') flits(knop);
          bedienApparaat(a, a.bediening === 'start' ? true : !a.aan);
        }, { bereikbaar: a.bereikbaar && !staat.bezig.has(a.id) });
        return knop;
      });
  } else {
    knoppen = (staat.huis?.scenes ?? []).map((sc) => {
      const knop = dockKnop(sc.naam, null, async () => {
        flits(knop);
        try {
          await post(`/api/scene/${encodeURIComponent(sc.id)}`);
        } catch (fout) {
          console.error('Scène starten mislukt', fout);
          meldFout(`${sc.naam} lukte niet`);
        }
        setTimeout(laadHuis, 800);
      });
      return knop;
    });
  }
  $('scenes').replaceChildren(...knoppen);
  tekenDock();
}

/** Favorieten: in het dock op Thuis (alleen aan/uit), en als kaart met schuifjes op Overzicht. */
function tekenFavorieten() {
  const ids = staat.inst?.favorieten ?? [];
  const lijst = staat.apparaten ? ids.map((id) => staat.apparaten!.find((a) => a.id === id)).filter((a): a is Apparaat => !!a) : [];
  // Zonder favorieten verdwijnt de kaart; een ster bij Apparaten zet ze erop.
  $('favorieten-blok').classList.toggle('leeg', lijst.length === 0);
  $('dock-favorieten').replaceChildren(
    ...lijst.map((a) =>
      dockKnop(a.naam, a.bediening === 'schakel' ? !!a.aan : null, () => bedienApparaat(a, a.bediening === 'start' ? true : !a.aan), {
        bereikbaar: a.bereikbaar && !staat.bezig.has(a.id),
        lamp: a.soort === 'light',
      }),
    ),
  );
  tekenDock();
  if (schuiftNu() && $('favorieten').querySelector('input[type=range]')) return;
  $('favorieten').replaceChildren(
    ...lijst.map((a) => {
      const vak = maak('div', 'favoriet-vak' + (a.aan ? ' aan' : ''));
      const tegel = maak('button', 'favoriet' + (a.aan ? ' aan' : ''));
      tegel.type = 'button';
      tegel.disabled = !a.bereikbaar || staat.bezig.has(a.id);
      if (a.bediening === 'schakel') tegel.setAttribute('aria-pressed', String(!!a.aan));
      tegel.append(maak('span', 'favoriet-lamp'), maak('strong', undefined, a.naam), maak('span', 'muted klein', a.bereikbaar ? a.tekst || 'Starten' : 'Niet bereikbaar'));
      tegel.addEventListener('click', () => bedienApparaat(a, a.bediening === 'start' ? true : !a.aan));
      vak.append(tegel);
      // Bij een brandende dimbare lamp meteen een schuifje voor de helderheid.
      const schuiven = a.aan ? lampSchuiven({ ...a, lamp: a.lamp && { ...a.lamp, kleurtemp: null } }, () => setTimeout(laadApparaten, 400)) : null;
      if (schuiven) vak.append(schuiven);
      return vak;
    }),
  );
}

/** Het dock verdwijnt als er niets in staat, en het streepje alleen als er aan beide kanten iets staat. */
function tekenDock() {
  const blokken = staat.inst?.blokken ?? {};
  // Op Overzicht staan de favorieten als kaart, niet in het dock.
  const fav = blokken.favorieten !== false && staat.scherm !== 'overzicht' && $('dock-favorieten').childElementCount > 0;
  const knoppen = blokken.scenes !== false && $('scenes').childElementCount > 0;
  $('dock-scheiding').hidden = !(fav && knoppen);
  $('dock').hidden = !fav && !knoppen;
}

async function laadApparaten() {
  if (!staat.inst?.favorieten.length && !staat.inst?.snelkoppelingen.length && staat.scherm !== 'apparaten') return;
  try {
    const antwoord = await fetch('/api/apparaten');
    if (!antwoord.ok) return;
    const data = (await antwoord.json()) as { ruimtes: { apparaten: Apparaat[] }[]; overig: Apparaat[] };
    staat.apparaten = [...data.ruimtes.flatMap((r) => r.apparaten), ...data.overig];
  } catch {
    return;
  }
  tekenFavorieten();
  tekenScenes();
}

/** Zet een apparaat in of uit de favorieten of de knoppen onderin, en bewaart dat op de server. */
async function wisselLijst(lijst: 'favorieten' | 'snelkoppelingen', id: string) {
  if (!staat.inst) return;
  const huidig = staat.inst[lijst];
  const nieuw = huidig.includes(id) ? huidig.filter((x) => x !== id) : [...huidig, id];
  staat.inst = { ...staat.inst, [lijst]: nieuw };
  try {
    const antwoord = await fetch('/api/instellingen', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [lijst]: nieuw }),
    });
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    zetInst(await antwoord.json());
  } catch (fout) {
    console.error('Bewaren mislukt', fout);
    meldFout('Bewaren lukte niet');
  }
}

/** Eigen naam voor een apparaat; een lege naam zet de naam uit Home Assistant terug. */
async function hernoem(id: string, naam: string) {
  try {
    const antwoord = await fetch('/api/instellingen', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namen: { [id]: naam } }),
    });
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    zetInst(await antwoord.json());
    laadHuis();
    laadApparaten();
  } catch (fout) {
    console.error('Naam bewaren mislukt', fout);
    meldFout('Naam bewaren lukte niet');
  }
}

let cameraGetoond = '';
/** Tijd van het laatste beeld dat wel binnenkwam, zodat een haperende camera een oud beeld met tijd laat zien. */
let laatsteBeeld: number | null = null;
function tekenCamera(verversen = false) {
  const cameras = staat.huis?.cameras ?? [];
  const camera = cameras[staat.camera % Math.max(cameras.length, 1)];
  const wissel = $<HTMLButtonElement>('camera-wissel');
  wissel.hidden = cameras.length < 2;
  tekst(wissel, `${(staat.camera % Math.max(cameras.length, 1)) + 1}/${cameras.length} ›`);
  wissel.setAttribute('aria-label', 'Volgende camera');
  tekst($('camera-naam'), camera?.naam ?? 'Camera');
  const beeld = $<HTMLImageElement>('camera-beeld');
  if (!camera || staat.huis?.bron !== 'home-assistant') {
    beeld.hidden = true;
    tekst($('camera-leeg'), !camera ? 'Geen camera gevonden' : 'Voorbeeld, geen camerabeeld');
  } else if (verversen || cameraGetoond !== camera.id) {
    if (cameraGetoond !== camera.id) laatsteBeeld = null;
    cameraGetoond = camera.id;
    beeld.alt = `Camerabeeld ${camera.naam}`;
    laadBeeld(`/api/camera/${encodeURIComponent(camera.id)}?t=${Date.now()}`);
  }
  const beweging = $('beweging');
  beweging.parentElement!.hidden = !camera?.beweging;
  if (camera?.beweging) tekst(beweging, `Beweging om ${uur(camera.beweging)}`);
}

function tekenWeer() {
  const weer = staat.huis?.weer ?? staat.overzicht?.weer;
  tekst($('weer'), weer ? `${weer.temperatuur != null ? `${Math.round(weer.temperatuur)}° ` : ''}${weer.omschrijving.toLowerCase()}` : '');
}

/** Een regel onderin, alleen zolang iets echt nog voorbeeld is. */
function tekenOpmerking() {
  const opmerking = $('voorbeeld');
  const huis = staat.huis?.bron === 'voorbeeld';
  const google = !!staat.overzicht?.voorbeeld;
  if (huis && google) tekst(opmerking, 'Voorbeeldgegevens · stel Home Assistant in en koppel Google via het tandwiel');
  else if (huis) tekst(opmerking, 'Het huis is voorbeeld · stel Home Assistant in om je eigen huis te zien');
  else tekst(opmerking, 'Agenda en mail zijn voorbeeld · koppel Google via het tandwiel');
  opmerking.hidden = !huis && !google;
}

function tekenAlles() {
  tekenKnoppen();
  tekenHuis();
  tekenKamer();
  tekenHud();
  tekenScenes();
  tekenCamera();
  tekenWeer();
  tekenOpmerking();
  if (staat.inst) tekenStand();
}

// Waar de blokken staan. Op Thuis staan ze rond het huis; op Overzicht in drie kolommen die elk op hun eigen hoogte
// stapelen, zodat er geen gaten vallen.
const THUIS: [string, string[]][] = [
  ['plek-links', ['dagstart', 'vandaag', 'belangrijk', 'mail']],
  ['plek-rechts', ['kamer', 'camera']],
];
const OVERZICHT: [string, string[]][] = [
  ['kolom-dag', ['dagstart', 'vandaag', 'belangrijk', 'mail']],
  ['kolom-huis', ['camera', 'tijdlijn', 'energie', 'kamer', 'favorieten', 'dock']],
];
function zetBlokken(overzicht: boolean) {
  const blok = (id: string) => (id === 'dock' ? $('dock') : document.querySelector<HTMLElement>(`.stage [data-blok="${id}"]:not(.dock-deel)`)!);
  for (const [plek, ids] of overzicht ? OVERZICHT : THUIS) for (const id of ids) $(plek).append(blok(id));
  if (!overzicht) $('plek-dock').append($('dock'));
}

let wisselKlaar: ReturnType<typeof setTimeout> | undefined;

// Schermen en blokken uit het tandwiel.
function pasToe() {
  const blokken = staat.inst?.blokken ?? {};
  document.querySelectorAll<HTMLElement>('[data-blok]').forEach((el) => el.classList.toggle('uit', blokken[el.dataset.blok!] === false));
  const overzicht = staat.scherm === 'overzicht';
  const pagina = staat.scherm === 'apparaten' || staat.scherm === 'cameras';
  const huisUit = blokken.huis === false;
  const achter = overzicht || pagina || (huisUit && !staat.huisVoor);
  const app = document.querySelector('.app')!;
  if (app.classList.contains('overzicht') !== overzicht) zetBlokken(overzicht);
  // Bij een ander scherm komen de panelen kort na elkaar zacht binnen.
  if (app.getAttribute('data-scherm') !== staat.scherm) {
    app.setAttribute('data-scherm', staat.scherm);
    app.classList.remove('wissel');
    void (app as HTMLElement).offsetWidth;
    app.classList.add('wissel');
    clearTimeout(wisselKlaar);
    wisselKlaar = setTimeout(() => app.classList.remove('wissel'), 1200);
  }
  app.classList.toggle('overzicht', overzicht);
  app.classList.toggle('op-pagina', pagina);
  $('pagina-apparaten').hidden = staat.scherm !== 'apparaten';
  $('pagina-cameras').hidden = staat.scherm !== 'cameras';
  if (staat.scherm === 'apparaten') apparaten.laad();
  if (staat.scherm === 'cameras') {
    cameraScherm.zet(staat.huis?.cameras ?? []);
    cameraScherm.ververs();
    cameraScherm.laadOpnames();
  }
  app.classList.toggle('huis-achter', achter);
  // De huisknop staat er alleen als het huis uit staat: dan haal je het ermee naar voren.
  $('huis-knop').hidden = !huisUit || pagina || overzicht;
  $('huis-knop').setAttribute('aria-pressed', String(!achter));
  $('huis-knop').setAttribute('aria-label', achter ? 'Huis naar voren halen' : 'Huis naar achteren');
  document.title = `Atlas · ${{ thuis: 'Thuis', overzicht: 'Overzicht', apparaten: 'Apparaten', cameras: "Camera's" }[staat.scherm]}`;
  document.querySelectorAll<HTMLButtonElement>('[data-scherm]').forEach((k) => {
    const gekozen = k.dataset.scherm === staat.scherm;
    k.setAttribute('aria-pressed', String(gekozen));
    if (gekozen) k.setAttribute('aria-current', 'page');
    else k.removeAttribute('aria-current');
  });
  tekenDock();
}

const apparaten = maakApparaten(() => laadHuis(), {
  heeft: (lijst, id) => !!staat.inst?.[lijst].includes(id),
  wissel: wisselLijst,
  hernoem,
});
const cameraScherm = maakCameras();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (staat.scherm === 'apparaten') apparaten.laad();
  if (staat.scherm === 'cameras') cameraScherm.ververs();
}, 5_000);
setInterval(() => document.visibilityState === 'visible' && staat.scherm === 'cameras' && cameraScherm.laadOpnames(), 30_000);

const dag = 86_400_000;
const middag = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const korteDatum = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
function tekenBelangrijk() {
  const vandaag = middag(new Date().toLocaleDateString('sv-SE'));
  // Ophaaldagen van vandaag tot overmorgen staan tussen de data; verder vooruit is nog niet nodig.
  const afval = staat.inst?.blokken.afval === false ? [] : staat.afval.filter((a) => middag(a.datum) - vandaag <= 2 * dag).map((a) => ({ id: a.id, titel: a.naam, datum: a.datum, van: null, afval: true }));
  const lijst = [...(staat.inst?.belangrijk ?? []).filter((d) => middag(d.datum) >= vandaag), ...afval]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .slice(0, 5);
  // Zonder data verdwijnt het blok; data toevoegen gaat via het tandwiel.
  document.querySelector('.stage [data-blok="belangrijk"]')!.classList.toggle('leeg', lijst.length === 0);
  if (lijst.length === 0) {
    $('belangrijk').replaceChildren();
    return;
  }
  $('belangrijk').replaceChildren(
    ...lijst.map((d) => {
      const rij = maak('div', 'datum-rij');
      const eind = middag(d.datum);
      const dagen = Math.round((eind - vandaag) / dag);
      const datum = korteDatum.format(eind).replace('.', '');
      let teller: string;
      let detail: string;
      let voortgang: number | null = null;
      if (d.van && middag(d.van) > vandaag) {
        const over = Math.round((middag(d.van) - vandaag) / dag);
        teller = over === 1 ? 'morgen' : `over ${over} dagen`;
        detail = `begint ${korteDatum.format(middag(d.van)).replace('.', '')} · t/m ${datum}`;
      } else if (d.van) {
        const begin = middag(d.van);
        const weken = Math.max(1, Math.ceil((eind - begin + dag) / (7 * dag)));
        const week = Math.min(weken, Math.floor((vandaag - begin) / (7 * dag)) + 1);
        teller = `week ${week} / ${weken}`;
        detail = `t/m ${datum} · nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}`;
        voortgang = Math.min(1, (vandaag - begin) / Math.max(dag, eind - begin));
      } else {
        const isAfval = 'afval' in d;
        if (dagen <= 7 && !isAfval) rij.classList.add('dringend');
        teller = dagen === 0 ? 'vandaag' : dagen === 1 ? 'morgen' : isAfval ? new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(eind) : `nog ${dagen} dagen`;
        detail = isAfval ? `Afval · ${datum}` : datum;
      }
      const kop = maak('div', 'kop');
      kop.append(maak('strong', undefined, d.titel), maak('span', 'mono', teller));
      rij.append(kop, maak('span', 'muted klein', detail));
      if (voortgang != null) {
        const balk = maak('div', 'balk');
        const vul = maak('span');
        vul.style.width = `${Math.round(voortgang * 100)}%`;
        balk.append(vul);
        rij.append(balk);
      }
      return rij;
    }),
  );
}

// Meldingen van Frigate in beeld, zolang de pagina open staat. De Windows-app laat ze ook zien als het venster verstopt is.
type Melding = { volg: number; titel: string; tekst: string; beeld: string | null; pc: boolean };
let laatsteMelding: number | null = null;
function toonMelding(m: Melding) {
  const toast = maak('button', 'gl toast');
  toast.type = 'button';
  toast.setAttribute('aria-label', `${m.titel}, ${m.tekst}. Open de camera's`);
  const binnen = maak('div', 'gl-in');
  if (m.beeld) {
    const beeld = maak('img', 'toast-beeld');
    beeld.alt = '';
    beeld.src = m.beeld;
    beeld.addEventListener('error', () => beeld.remove());
    binnen.append(beeld);
  }
  const tekstDeel = maak('div', 'toast-tekst');
  const kop = maak('div', 'toast-kop');
  kop.append(maak('span', 'stip'), maak('strong', undefined, m.titel));
  tekstDeel.append(kop, maak('span', 'muted klein', m.tekst));
  binnen.append(tekstDeel);
  toast.append(binnen);
  $('toasts').append(toast);
  const weg = () => {
    toast.classList.add('weg');
    setTimeout(() => toast.remove(), 400);
  };
  // Klikken opent het scherm met alle camera's.
  toast.addEventListener('click', () => {
    weg();
    staat.scherm = 'cameras';
    pasToe();
  });
  setTimeout(weg, 12_000);
}
async function laadMeldingen() {
  try {
    const antwoord = await fetch(`/api/meldingen${laatsteMelding == null ? '' : `?na=${laatsteMelding}`}`);
    if (!antwoord.ok) return;
    const data = (await antwoord.json()) as { laatste: number; meldingen: Melding[] };
    // De eerste keer alleen onthouden waar we zijn, anders komen oude meldingen opnieuw voorbij.
    if (laatsteMelding != null && data.laatste >= laatsteMelding) data.meldingen.filter((m) => m.pc).slice(-3).forEach(toonMelding);
    laatsteMelding = data.laatste;
  } catch {
    // De server is even weg; de volgende ronde probeert het opnieuw.
  }
}

// Blokken voor de apps op de server.
type AppBasis = { gevonden: boolean; poort?: number; sleutel?: boolean; bereikbaar?: boolean };
type Apps = {
  frigate: (AppBasis & { vandaag?: Record<string, number>; laatste?: { id: string; camera: string; soort: string; tijd: string; beeld: string }[] }) | null;
  jellyfin: (AppBasis & { verder?: Media[]; nieuw?: Media[] }) | null;
  seerr: (AppBasis & { wachtend?: number; bezig?: number; beschikbaar?: number }) | null;
  downloads:
    | (AppBasis & {
        apps: { naam: string; poort: number; sleutel: boolean }[];
        items?: { app: string; titel: string; voortgang: number; resterend: string | null; status: string }[];
      })
    | null;
};
type Media = { id: string; titel: string; sub: string; voortgang: number | null; beeld: string };

const soortMeervoud: Record<string, [string, string]> = {
  person: ['persoon', 'personen'],
  car: ['auto', "auto's"],
  bicycle: ['fiets', 'fietsen'],
  motorcycle: ['motor', 'motoren'],
  dog: ['hond', 'honden'],
  cat: ['kat', 'katten'],
  bird: ['vogel', 'vogels'],
  package: ['pakket', 'pakketten'],
};
const cameraNaam = (camera: string) => camera.replace(/_/g, ' ').replace(/^\w/, (l) => l.toUpperCase());
const appAdres = (poort: number) => `${location.protocol}//${location.hostname}:${poort}`;

function balk(procent: number) {
  const b = maak('div', 'balk');
  const vul = maak('span');
  vul.style.width = `${Math.max(0, Math.min(100, procent))}%`;
  b.append(vul);
  return b;
}

function plaatje(src: string, klasse: string) {
  const img = maak('img', klasse);
  img.alt = '';
  img.loading = 'lazy';
  img.src = src;
  img.addEventListener('error', () => (img.style.visibility = 'hidden'));
  return img;
}

function zetLink(id: string, poort: number | undefined) {
  const link = document.querySelector<HTMLAnchorElement>(`[data-app-link="${id}"]`)!;
  link.hidden = !poort;
  if (poort) link.href = appAdres(poort);
}

function tekenApps(a: Apps) {
  const melding = (tekst: string) => [maak('p', 'muted klein', tekst)];

  if (a.frigate) {
    const f = a.frigate;
    zetLink('frigate', f.gevonden ? f.poort : undefined);
    let inhoud: HTMLElement[];
    if (!f.gevonden) inhoud = melding('Frigate niet gevonden op poort 5000.');
    else if (!f.bereikbaar) inhoud = melding('Frigate reageert niet.');
    else {
      const telling = Object.entries(f.vandaag ?? {})
        .sort((x, y) => y[1] - x[1])
        .map(([soort, n]) => `${n} ${(soortMeervoud[soort] ?? [soort, soort])[n === 1 ? 0 : 1]}`);
      inhoud = [maak('p', 'klein', telling.length ? `Vandaag ${telling.join(' · ')}` : 'Vandaag nog niets gezien.')];
      if (f.laatste?.length) {
        const rij = maak('div', 'app-beelden');
        for (const g of f.laatste) {
          const vak = maak('figure', 'app-beeld');
          const onderschrift = maak('figcaption', 'klein');
          onderschrift.append(maak('span', 'mono', uur(g.tijd)), ` ${cameraNaam(g.camera)}`);
          vak.append(plaatje(g.beeld, ''), onderschrift);
          rij.append(vak);
        }
        inhoud.push(rij);
      }
    }
    $('app-frigate').replaceChildren(...inhoud);
  }

  if (a.jellyfin) {
    const j = a.jellyfin;
    zetLink('jellyfin', j.gevonden ? j.poort : undefined);
    let inhoud: HTMLElement[];
    if (!j.gevonden) inhoud = melding('Jellyfin niet gevonden op poort 8096.');
    else if (!j.sleutel) inhoud = melding('Jellyfin draait. Vul JELLYFIN_KEY in bij Atlas in ZimaOS om te zien wat je kijkt.');
    else if (!j.bereikbaar) inhoud = melding('Jellyfin reageert niet. Klopt JELLYFIN_KEY?');
    else {
      inhoud = [];
      for (const m of j.verder ?? []) {
        const rij = maak('div', 'media-rij');
        const tekstDeel = maak('div');
        tekstDeel.append(maak('strong', undefined, m.titel), maak('span', 'muted klein', m.sub));
        if (m.voortgang != null) tekstDeel.append(balk(m.voortgang));
        rij.append(plaatje(m.beeld, 'poster'), tekstDeel);
        inhoud.push(rij);
      }
      // Nieuwe titels alleen als er niets is om verder te kijken; anders wordt het blok te druk.
      if (j.nieuw?.length && !inhoud.length) {
        inhoud.push(maak('p', 'inst-label', 'Nieuw'));
        const rij = maak('div', 'posters');
        for (const m of j.nieuw.slice(0, 5)) {
          const p = plaatje(m.beeld, 'poster');
          p.title = m.titel;
          p.alt = m.titel;
          rij.append(p);
        }
        inhoud.push(rij);
      }
      if (!inhoud.length) inhoud = melding('Niets om verder te kijken.');
    }
    $('app-jellyfin').replaceChildren(...inhoud);
  }

  if (a.seerr) {
    const z = a.seerr;
    zetLink('seerr', z.gevonden ? z.poort : undefined);
    let inhoud: HTMLElement[];
    if (!z.gevonden) inhoud = melding('Seerr niet gevonden op poort 5055.');
    else if (!z.sleutel) inhoud = melding('Seerr draait. Vul SEERR_KEY in bij Atlas in ZimaOS om je aanvragen te zien.');
    else if (!z.bereikbaar) inhoud = melding('Seerr reageert niet. Klopt SEERR_KEY?');
    else {
      const tegels = maak('div', 'tellers');
      for (const [n, naam, warm] of [
        [z.wachtend ?? 0, 'wachten', true],
        [z.bezig ?? 0, 'bezig', false],
        [z.beschikbaar ?? 0, 'beschikbaar', false],
      ] as const) {
        const t = maak('span', 'teller' + (warm && n > 0 ? ' warm' : ''));
        t.append(maak('span', 'mono', String(n)), ` ${naam}`);
        tegels.append(t);
      }
      inhoud = [tegels];
    }
    $('app-seerr').replaceChildren(...inhoud);
  }

  if (a.downloads) {
    const d = a.downloads;
    zetLink('downloads', d.apps[0]?.poort);
    let inhoud: HTMLElement[];
    if (!d.gevonden) inhoud = melding('Sonarr en Radarr niet gevonden op poort 8989 en 7878.');
    else if (!d.apps.some((x) => x.sleutel))
      inhoud = melding(`${d.apps.map((x) => x.naam).join(' en ')} draait. Vul SONARR_KEY of RADARR_KEY in bij Atlas in ZimaOS om je downloads te zien.`);
    else if (!d.items?.length) inhoud = melding('Niets aan het downloaden.');
    else
      inhoud = d.items.map((i) => {
        const rij = maak('div', 'download');
        const kop = maak('div', 'kop');
        kop.append(maak('span', 'download-titel', i.titel), maak('span', 'mono muted klein', i.resterend ?? `${i.voortgang}%`));
        rij.append(kop, balk(i.voortgang));
        return rij;
      });
    $('app-downloads').replaceChildren(...inhoud);
  }
}

async function laadApps() {
  try {
    const antwoord = await fetch('/api/apps');
    if (antwoord.ok) tekenApps(await antwoord.json());
  } catch {
    // Volgende ronde opnieuw.
  }
}

async function kijkVersie() {
  try {
    const v = (await (await fetch('/api/versie')).json()) as { nieuw: boolean };
    $('tandwiel').classList.toggle('nieuw', v.nieuw);
    $('tandwiel').setAttribute('aria-label', v.nieuw ? 'Instellingen, nieuwe versie beschikbaar' : 'Instellingen');
  } catch {
    // Later opnieuw.
  }
}

async function laadInstellingen() {
  try {
    const antwoord = await fetch('/api/instellingen');
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    zetInst(await antwoord.json(), true);
  } catch (fout) {
    console.error('Instellingen laden mislukt', fout);
  }
}

// Ochtend- en avondstand. Buiten die uren gewoon Thuis en Overzicht zoals altijd.
type Stand = 'ochtend' | 'avond' | null;
function nuIn(p: { aan: boolean; van: string; tot: string }) {
  if (!p.aan) return false;
  const nu = new Date();
  const tijd = nu.getHours() * 60 + nu.getMinutes();
  const [van, tot] = [p.van, p.tot].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  return van <= tot ? tijd >= van && tijd < tot : tijd >= van || tijd < tot;
}
function huidigeStand(): Stand {
  const st = staat.inst?.standen;
  if (!st) return null;
  return nuIn(st.ochtend) ? 'ochtend' : nuIn(st.avond) ? 'avond' : null;
}

/** De kaart bovenaan in de ochtend- of avondstand: een begroeting en in één zin wat er is. */
function tekenStand() {
  const stand = huidigeStand();
  const app = document.querySelector('.app')!;
  app.classList.toggle('stand-ochtend', stand === 'ochtend');
  app.classList.toggle('stand-avond', stand === 'avond');
  $('dagstart').hidden = !stand;
  if (!stand) return;
  const o = staat.overzicht;
  const weer = staat.huis?.weer ?? o?.weer;
  const weerTekst = weer ? `${weer.temperatuur != null ? `${Math.round(weer.temperatuur)}° ` : ''}${weer.omschrijving.toLowerCase()}` : '';
  const datum = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  tekst($('dagstart-label'), stand === 'ochtend' ? `${datum}${weerTekst ? ` · ${weerTekst}` : ''}` : 'Avond');
  tekst($('dagstart-titel'), begroeting());
  let zin: string;
  if (stand === 'ochtend') {
    const n = o?.agenda.length ?? 0;
    const eerste = o?.agenda[0];
    const deadline = (staat.inst?.belangrijk ?? [])
      .map((d) => ({ ...d, dagen: Math.round((middag(d.datum) - middag(new Date().toLocaleDateString('sv-SE'))) / dag) }))
      .filter((d) => d.dagen >= 0 && !d.van)
      .sort((a, b) => a.dagen - b.dagen)[0];
    zin = n === 0 ? 'Vandaag staat er niets in je agenda.' : `${n === 1 ? 'Eén afspraak' : `${n} afspraken`} vandaag${eerste ? `, de eerste om ${eerste.tijd}: ${eerste.titel}` : ''}.`;
    if (deadline && deadline.dagen <= 14) zin += ` ${deadline.titel} ${deadline.dagen === 0 ? 'is vandaag' : deadline.dagen === 1 ? 'is morgen' : `over ${deadline.dagen} dagen`}.`;
  } else {
    const lampen = staat.huis ? [...staat.huis.kamers.flatMap((k) => k.lampen), ...staat.huis.losseLampen] : [];
    const aan = lampen.filter((l) => l.aan).length;
    zin = `${o?.morgen ? `Morgen ${o.morgen}.` : 'Morgen staat er niets gepland.'} ${aan === 0 ? 'Alle lampen zijn uit.' : `${aan} ${aan === 1 ? 'lamp is' : 'lampen zijn'} nog aan.`}`;
    const morgen = new Date(Date.now() + dag).toLocaleDateString('sv-SE');
    const buiten = staat.inst?.blokken.afval === false ? [] : staat.afval.filter((a) => a.datum === morgen).map((a) => a.naam);
    if (buiten.length) zin += ` Morgen ${buiten.join(' en ')} aan de straat.`;
  }
  tekst($('dagstart-tekst'), zin);
  tekenVertrek();
}

// Vertrekhulp: in Vandaag (en 's ochtends in de begroeting) hoe laat je weg moet en of het dan regent.
function vertrekTekst() {
  if (staat.inst?.blokken.vertrek === false) return null;
  const v = staat.vertrek;
  const r = staat.regen;
  const nu = Date.now();
  // Alleen als het vertrek binnen vier uur is; anders is het nog niet relevant.
  const binnenkort = v && new Date(v.om).getTime() - nu < 4 * 3_600_000;
  if (binnenkort) return { tekst: `Vertrek ${uur(v.om)} · ${v.plek ?? v.titel}${r ? ` · ${r.tekst.toLowerCase()}` : ''}`, nat: !!r?.komt };
  if (r?.komt) return { tekst: r.tekst, nat: true };
  return null;
}
function tekenVertrek() {
  const t = vertrekTekst();
  for (const id of ['vertrek', 'dagstart-vertrek']) {
    const el = $(id);
    el.hidden = !t || (id === 'dagstart-vertrek' && huidigeStand() !== 'ochtend');
    el.classList.toggle('nat', !!t?.nat);
    if (t) tekst(el, t.tekst);
  }
}
async function laadVertrek() {
  try {
    const [v, a] = await Promise.all([
      fetch('/api/vertrek').then((x) => (x.ok ? x.json() : null)),
      fetch('/api/afval').then((x) => (x.ok ? x.json() : null)),
    ]);
    if (v) {
      staat.vertrek = v.vertrek;
      staat.regen = v.regen;
    }
    if (a) staat.afval = a.lijst;
  } catch {
    // Laatste waarden blijven staan.
  }
  tekenVertrek();
  tekenBelangrijk();
  if (staat.inst) tekenStand();
}

// Tijdlijn: wat de camera's vandaag zagen, ook tijdens de stille uren.
type Gezien = { id: string; camera: string; titel: string; tijd: string; beeld: string; gemeld: boolean };
function tekenTijdlijn(lijst: Gezien[] | null) {
  for (const [id, aantal] of [['tijdlijn', 'tijdlijn-aantal'], ['tijdlijn-pagina-lijst', 'tijdlijn-pagina-aantal']] as const) {
    const ol = $(id);
    tekst($(aantal), lijst?.length ? `${lijst.length}×` : '');
    ol.replaceChildren(
      ...(lijst?.length
        ? lijst.slice(0, id === 'tijdlijn' ? 5 : 30).map((g) => {
            const li = maak('li', 'gezien');
            const beeld = maak('img', 'gezien-beeld');
            beeld.alt = '';
            beeld.loading = 'lazy';
            beeld.src = g.beeld;
            beeld.addEventListener('error', () => (beeld.style.visibility = 'hidden'));
            const tekstDeel = maak('div', 'gezien-tekst');
            tekstDeel.append(maak('strong', undefined, g.titel), maak('span', 'muted klein', `${g.camera}${g.gemeld ? '' : ' · niet gemeld'}`));
            li.append(maak('span', 'mono gezien-tijd', uur(g.tijd)), beeld, tekstDeel);
            return li;
          })
        : [maak('p', 'muted klein', lijst ? 'Vandaag nog niets gezien.' : 'Frigate is niet gevonden.')]),
    );
  }
  // Op Overzicht verdwijnt het blok als Frigate er niet is of er niets te zien is.
  $('tijdlijn-blok').classList.toggle('leeg', !lijst?.length);
  $('tijdlijn-pagina').classList.toggle('leeg', !lijst);
}
async function laadTijdlijn() {
  try {
    const antwoord = await fetch('/api/meldingen/vandaag');
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    const data = (await antwoord.json()) as { frigate: boolean; lijst: Gezien[] };
    tekenTijdlijn(data.frigate ? data.lijst : null);
  } catch {
    tekenTijdlijn(null);
  }
}

function tekenSfeer() {
  tekenLucht(document.querySelector<HTMLElement>('.app')!, staat.inst?.blokken.lucht !== false);
  tekenStand();
}

function zetInst(inst: Instellingen, eerste = false) {
  // Het huis net uitgezet of weer aangezet: dan geldt de nieuwe stand meteen.
  if (inst.blokken.huis !== staat.inst?.blokken.huis) staat.huisVoor = false;
  staat.inst = inst;
  if (eerste) staat.scherm = inst.start[matchMedia('(max-width: 1000px)').matches ? 'smal' : 'breed'];
  pasToe();
  tekenBelangrijk();
  tekenFavorieten();
  tekenScenes();
  tekenSfeer();
  if (eerste || !staat.apparaten) laadApparaten();
  if (!eerste) laadApps();
}

// Een vaste kleurtint per afzender, zodat je ze herkent.
const tint = (tekst: string) => [...tekst].reduce((h, l) => (h * 31 + l.charCodeAt(0)) % 360, 7);
const aantalTekst = (o: Overzicht) => {
  const n = o.mailAantal ?? o.mail.length;
  return o.voorbeeld ? `${n} ongelezen` : `${n} belangrijk`;
};
function wanneer(iso: string) {
  const d = new Date(iso);
  const vandaag = new Date().toDateString();
  if (d.toDateString() === vandaag) return uur(iso);
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'gisteren';
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function tekenOverzicht(o: Overzicht) {
  tekst($('aantal-afspraken'), o.agendaFout ? 'niet bereikbaar' : `${o.agenda.length} ${o.agenda.length === 1 ? 'afspraak' : 'afspraken'}`);
  $('agenda').replaceChildren(
    ...(o.agenda.length === 0 && !o.agendaFout ? [maak('p', 'muted klein', 'Niets meer vandaag.')] : []),
    ...o.agenda.map((a) => {
      const rij = maak('div', 'afspraak');
      const blok = maak('div');
      if (a.kleur) blok.style.borderLeftColor = a.kleur;
      blok.append(maak('strong', undefined, a.titel), maak('span', 'muted klein', a.detail));
      rij.append(maak('span', 'mono', a.tijd), blok);
      return rij;
    }),
  );
  tekst($('morgen'), o.morgen ? `Morgen ${o.morgen}` : 'Morgen niets gepland');
  const aantal = o.mailAantal ?? o.mail.length;
  tekst($('mail-aantal'), o.mailFout ? 'niet bereikbaar' : aantalTekst(o));
  $('mail').replaceChildren(
    ...(o.mail.length === 0 && !o.mailFout ? [maak('p', 'muted klein', 'Geen belangrijke mail. Lekker rustig.')] : []),
    ...o.mail.map((m) => {
      const rij = maak(m.link ? 'a' : 'div', 'mailregel');
      if (m.link && rij instanceof HTMLAnchorElement) {
        rij.href = m.link;
        rij.target = '_blank';
        rij.rel = 'noopener';
        rij.setAttribute('aria-label', `Mail van ${m.van}: ${m.onderwerp}`);
      }
      const letter = maak('span', 'mail-letter', (m.van.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase());
      letter.style.setProperty('--tint', String(tint(m.van)));
      const tekstDeel = maak('div', 'mail-tekst');
      const kop = maak('div', 'mail-kop');
      kop.append(maak('strong', undefined, m.van), maak('span', 'mono muted klein', m.tijd ? wanneer(m.tijd) : ''));
      tekstDeel.append(kop, maak('span', 'mail-onderwerp', m.onderwerp));
      if (m.stukje) tekstDeel.append(maak('span', 'muted klein mail-stukje', m.stukje));
      rij.append(letter, tekstDeel);
      return rij;
    }),
  );
}

async function laadOverzicht() {
  try {
    const antwoord = await fetch('/api/overzicht');
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    staat.overzicht = await antwoord.json();
    tekenOverzicht(staat.overzicht!);
    tekenStand();
    tekenWeer();
    tekenOpmerking();
  } catch (fout) {
    console.error('Overzicht laden mislukt', fout);
  }
}

let eersteKeer = true;
async function laadHuis() {
  try {
    const antwoord = await fetch('/api/huis');
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    staat.huis = await antwoord.json();
    staat.huisFout = false;
    if (eersteKeer) {
      eersteKeer = false;
      const ruimte = lagen.flatMap((l) => l.ruimtes).find((r) => r.id === staat.gekozen);
      staat.kamer = (ruimte && kamerBij(ruimte)?.id) ?? null;
    }
  } catch (fout) {
    console.error('Huis laden mislukt', fout);
    staat.huisFout = true;
  }
  tekenAlles();
  if (staat.scherm === 'cameras') cameraScherm.zet(staat.huis?.cameras ?? []);
}

document.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((knop) => {
  knop.addEventListener('click', () => {
    staat.modus = knop.dataset.modus as '2d' | '3d' | 'vrij';
    tekenAlles();
  });
});
let laatsteScroll = 0;
$('huis').addEventListener(
  'wheel',
  (e) => {
    // In de draaistand zoomt scrollen in het model zelf.
    if (staat.modus === 'vrij' || document.querySelector('.app')!.classList.contains('huis-achter') || Math.abs(e.deltaY) < 4) return;
    e.preventDefault();
    // Eén stap per scrollbeweging, ook bij een touchpad dat veel kleine stapjes geeft.
    if (Date.now() - laatsteScroll < 450) return;
    laatsteScroll = Date.now();
    const nu = VERDIEPINGEN.indexOf(staat.verdieping);
    const volgende = Math.max(0, Math.min(VERDIEPINGEN.length - 1, nu + Math.sign(e.deltaY)));
    if (volgende !== nu) kiesVerdieping(VERDIEPINGEN[volgende]);
  },
  { passive: false },
);
// Het ruimtemenu onder de knop zetten, rechts uitgelijnd, en boven de knop als er onder geen plek is.
$('kamer-menu').addEventListener('toggle', (e) => {
  if ((e as ToggleEvent).newState !== 'open') return;
  const knop = $('kamer-kies').getBoundingClientRect();
  const menu = $('kamer-menu');
  const hoog = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(knop.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${knop.bottom + 8 + hoog > innerHeight ? Math.max(8, knop.top - 8 - hoog) : knop.bottom + 8}px`;
});
function kiesKamer(id: string | null) {
  staat.kamer = id;
  staat.gekozen = id && id !== LOS ? (ruimteBij(id)?.id ?? null) : null;
  tekenAlles();
}
$('camera-wissel').addEventListener('click', () => {
  staat.camera += 1;
  tekenCamera();
});
/**
 * Een nieuw camerabeeld eerst buiten beeld laden en pas wisselen als het binnen is, zodat het beeld niet knippert.
 * Lukt het niet, dan blijft het vorige staan met de tijd erbij; is er nog nooit een beeld geweest, dan een rustige tekst
 * in plaats van een leeg vlak.
 */
let gevraagd = '';
function laadBeeld(adres: string) {
  gevraagd = adres;
  const voorlader = new Image();
  voorlader.addEventListener('load', () => {
    // Intussen naar een andere camera gewisseld: dit beeld is niet meer nodig.
    if (adres !== gevraagd) return;
    const beeld = $<HTMLImageElement>('camera-beeld');
    beeld.src = adres;
    beeld.hidden = false;
    laatsteBeeld = Date.now();
    $('camera-leeg').hidden = true;
  });
  voorlader.addEventListener('error', () => adres === gevraagd && beeldMislukt());
  voorlader.src = adres;
}
function beeldMislukt() {
  const beeld = $<HTMLImageElement>('camera-beeld');
  const leeg = $('camera-leeg');
  leeg.hidden = false;
  if (laatsteBeeld == null) {
    beeld.hidden = true;
    tekst(leeg, 'Geen beeld van deze camera');
  } else tekst(leeg, `Laatste beeld ${new Date(laatsteBeeld).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`);
}

// Sneltoetsen: 1 t/m 4 voor de schermen, pijltjes voor de verdiepingen op Thuis. Uit te zetten in het tandwiel.
const SCHERMEN: Scherm[] = ['thuis', 'overzicht', 'apparaten', 'cameras'];
document.addEventListener('keydown', (e) => {
  if (staat.inst?.blokken.sneltoetsen === false || e.ctrlKey || e.metaKey || e.altKey) return;
  const doel = e.target as HTMLElement;
  if (doel.closest('input, select, textarea, [contenteditable], dialog[open]') || document.querySelector('dialog[open]')) return;
  const nummer = Number(e.key);
  if (nummer >= 1 && nummer <= SCHERMEN.length) {
    staat.scherm = SCHERMEN[nummer - 1];
    staat.huisVoor = false;
    pasToe();
    e.preventDefault();
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && staat.scherm === 'thuis' && !document.querySelector('.app.huis-achter')) {
    const nu = VERDIEPINGEN.indexOf(staat.verdieping);
    const volgende = Math.max(0, Math.min(VERDIEPINGEN.length - 1, nu + (e.key === 'ArrowDown' ? 1 : -1)));
    if (volgende !== nu) kiesVerdieping(VERDIEPINGEN[volgende]);
    e.preventDefault();
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-scherm]').forEach((knop) => {
  knop.addEventListener('click', () => {
    staat.scherm = knop.dataset.scherm as Scherm;
    staat.huisVoor = false;
    pasToe();
  });
});
$('huis-knop').addEventListener('click', () => {
  if (staat.scherm !== 'thuis') {
    staat.scherm = 'thuis';
    staat.huisVoor = true;
  } else staat.huisVoor = !staat.huisVoor;
  pasToe();
});

// Opdrachtbalk (Ctrl+K of /) en de spraakbol, die hem opent en meteen luistert.
const opdracht = startOpdracht({
  aan: () => staat.inst?.blokken.opdracht !== false,
  naarScherm: (scherm) => {
    staat.scherm = scherm;
    staat.huisVoor = false;
    pasToe();
  },
  ververs: () => void laadHuis(),
  tips: () => {
    const h = staat.huis;
    const kamer = h?.kamers.find((k) => k.lampen.length);
    const tips = [];
    if (kamer) tips.push(`${kamer.naam} ${kamer.lampen.some((l) => l.aan) ? 'uit' : 'aan'}`);
    const dimbaar = h?.kamers.find((k) => k.lampen.some((l) => l.dimbaar));
    if (dimbaar) tips.push(`Dim ${dimbaar.naam.toLowerCase()} naar 30%`);
    if (h?.scenes[0]) tips.push(h.scenes[0].naam);
    tips.push('Welke lampen zijn aan?', 'Hoe warm is het?');
    return tips;
  },
});
$('opdracht-knop').addEventListener('click', () => opdracht.open());
$('spraak-orb').addEventListener('click', () => opdracht.open(true));
tekst($('spraak-label'), kanSpraak ? 'Tik en spreek' : 'Tik en typ');

startGlans();
instellingen({ google: laadOverzicht, opgeslagen: (inst) => zetInst(inst) });
pasToe();
tekenBelangrijk();
laadInstellingen();
laadMeldingen();
setInterval(laadMeldingen, 5_000);
kijkVersie();
setInterval(kijkVersie, 30 * 60_000);
setInterval(() => document.visibilityState === 'visible' && laadApparaten(), 5_000);
laadApps();
setInterval(() => document.visibilityState === 'visible' && laadApps(), 30_000);
setInterval(tekenBelangrijk, 3_600_000);
tikKlok();
setInterval(tikKlok, 1000);
// Lucht, zon, maan en de standen veranderen per minuut.
setInterval(tekenSfeer, 60_000);
laadTijdlijn();
setInterval(() => document.visibilityState === 'visible' && laadTijdlijn(), 60_000);
laadVertrek();
setInterval(() => document.visibilityState === 'visible' && laadVertrek(), 120_000);
laadEnergie();
setInterval(() => document.visibilityState === 'visible' && staat.inst?.blokken.energie !== false && laadEnergie(), 30_000);
// Als app op de telefoon: de schil bewaren voor snel openen. Werkt alleen via https (Tailscale) of localhost.
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
tekenAlles();
laadOverzicht();
setInterval(laadOverzicht, 60_000);
laadHuis();
setInterval(laadHuis, 5_000);
setInterval(() => document.visibilityState === 'visible' && tekenCamera(true), 10_000);
