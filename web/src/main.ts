import './styles.css';
import { lagen, type Ruimte } from './huis';
import { instellingen, type Instellingen } from './instellingen';
import { maakApparaten, maakCameras } from './paginas';

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
type Apparaat = { id: string; naam: string; soort: string; tekst: string; aan: boolean | null; bediening: 'schakel' | 'start' | null; bereikbaar: boolean };
type Lamp = { id: string; naam: string; aan: boolean; helderheid: number | null; bereikbaar: boolean };
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
  modus: '3d' as '2d' | '3d',
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
};

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
  tekst($('datum'), datumFormaat.format(nu));
  const deel = (nu.getHours() * 60 + nu.getMinutes()) / 1440;
  $('dagboog').setAttribute('stroke-dasharray', `${Math.round(503 * deel)} 503`);
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

function tekenHuis() {
  const huis = $('huis');
  const driedee = staat.modus === '3d';
  const getoond = !driedee && staat.verdieping === 'alle' ? 'bg' : staat.verdieping;
  const gestapeld = getoond === 'alle';

  const gebouw = maak('div', 'gebouw' + (driedee ? '' : ' plat'));
  gebouw.style.transform = !driedee
    ? 'scale(0.92)'
    : gestapeld
      ? 'translateY(110px) rotateX(60deg) rotateZ(-38deg) scale(0.78)'
      : 'translateY(40px) rotateX(55deg) rotateZ(-38deg) scale(0.95)';

  for (const laag of lagen) {
    if (!gestapeld && getoond !== laag.id) continue;
    const vlak = maak('div', 'laag');
    vlak.style.height = `${laag.hoogte}%`;
    vlak.style.transform = `translateZ(${gestapeld ? laag.z : 0}px)`;
    vlak.style.boxShadow = gestapeld
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
    maak('span', 'rail-hint', 'scroll'),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((knop) => {
    knop.setAttribute('aria-pressed', String(knop.dataset.modus === staat.modus));
  });
}

async function zetLamp(lamp: Lamp, aan: boolean) {
  lamp.aan = aan; // meteen tonen, de volgende ronde van Home Assistant bevestigt het
  tekenAlles();
  try {
    const antwoord = await fetch(`/api/lamp/${encodeURIComponent(lamp.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aan }),
    });
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
  } catch (fout) {
    console.error('Lamp schakelen mislukt', fout);
    lamp.aan = !aan;
    tekenAlles();
  }
  setTimeout(laadHuis, 600);
}

function lampRij(lamp: Lamp) {
  const rij = maak('div', 'lamp');
  const info = maak('div', 'lamp-info');
  const namen = maak('span');
  const status = !lamp.bereikbaar ? 'Niet bereikbaar' : lamp.aan ? (lamp.helderheid != null ? `Aan · ${lamp.helderheid}%` : 'Aan') : 'Uit';
  namen.append(lamp.naam, maak('small', undefined, status));
  info.append(namen);
  const schakelaar = maak('button', 'schakelaar');
  schakelaar.type = 'button';
  schakelaar.setAttribute('role', 'switch');
  schakelaar.setAttribute('aria-checked', String(lamp.aan));
  schakelaar.setAttribute('aria-label', `${lamp.naam} ${lamp.aan ? 'uitzetten' : 'aanzetten'}`);
  schakelaar.disabled = !lamp.bereikbaar;
  schakelaar.addEventListener('click', () => zetLamp(lamp, !lamp.aan));
  rij.append(info, schakelaar);
  return rij;
}

function tekenKamer() {
  const huis = staat.huis;
  const ruimte = lagen.flatMap((l) => l.ruimtes.map((r) => ({ ...r, laag: l.naam }))).find((r) => r.id === staat.gekozen);
  const kamer = staat.kamer && staat.kamer !== LOS ? huis?.kamers.find((k) => k.id === staat.kamer) : undefined;
  const los = staat.kamer === LOS;

  // Keuzelijst met alle ruimtes uit Home Assistant, zodat ook ruimtes buiten de plattegrond bereikbaar zijn.
  const keuze = $<HTMLSelectElement>('kamer-keuze');
  const opties = [
    ...(huis?.kamers ?? []).filter((k) => k.lampen.length || k.temperatuur != null).map((k) => [k.id, k.naam]),
    ...(huis?.losseLampen.length ? [[LOS, 'Overige lampen']] : []),
  ];
  // Alleen opnieuw opbouwen als de ruimtes veranderen, anders klapt een open keuzelijst elke ronde dicht.
  const sleutel = JSON.stringify(opties);
  if (keuze.dataset.sleutel !== sleutel) {
    keuze.dataset.sleutel = sleutel;
    keuze.replaceChildren(
      Object.assign(maak('option', undefined, 'Kies een ruimte'), { value: '' }),
      ...opties.map(([id, naam]) => Object.assign(maak('option', undefined, naam), { value: id })),
    );
  }
  keuze.value = staat.kamer ?? '';
  keuze.hidden = opties.length === 0;

  const verdieping = kamer ? kamer.verdieping : los ? 'Huis' : ruimte?.laag;
  tekst($('kamer-label'), verdieping ? `KAMER · ${verdieping.toUpperCase()}` : 'KAMER');
  tekst($('kamer-naam'), los ? 'Overige lampen' : (kamer?.naam ?? ruimte?.naam ?? ''));
  tekst($('kamer-temp'), kamer?.temperatuur != null ? graden(kamer.temperatuur) : '');

  const lijst = $('lampen');
  const lampen = los ? (huis?.losseLampen ?? []) : (kamer?.lampen ?? []);
  if (!huis) {
    lijst.replaceChildren(maak('p', 'muted', staat.huisFout ? 'Home Assistant is niet bereikbaar.' : 'Lampen laden…'));
  } else if (!kamer && !los) {
    lijst.replaceChildren(maak('p', 'muted', 'Deze ruimte is nog niet gekoppeld aan een ruimte in Home Assistant.'));
  } else if (lampen.length === 0) {
    lijst.replaceChildren(maak('p', 'muted', 'Hier zijn geen lampen.'));
  } else {
    lijst.replaceChildren(...lampen.map(lampRij));
  }
}

function tekenHud() {
  const huis = staat.huis;
  const lampen = huis ? [...huis.kamers.flatMap((k) => k.lampen), ...huis.losseLampen] : [];
  const camera = huis?.cameras[0];
  $('hud').replaceChildren(
    maak('span', undefined, `BINNEN ${huis?.binnen != null ? graden(huis.binnen) : '--'}`),
    maak('span', 'warm', `LAMPEN ${lampen.filter((l) => l.aan).length} / ${lampen.length} AAN`),
    maak('span', undefined, `${(camera?.naam ?? 'Voordeur').toUpperCase()} ${camera?.beweging ? uur(camera.beweging) : '--:--'}`),
  );
}

async function bedienApparaat(a: Apparaat, aan: boolean) {
  if (a.bediening === 'schakel') a.aan = aan; // meteen tonen
  tekenFavorieten();
  tekenScenes();
  try {
    const antwoord = await fetch(`/api/apparaat/${encodeURIComponent(a.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aan }),
    });
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
  } catch (fout) {
    console.error('Bedienen mislukt', fout);
    if (a.bediening === 'schakel') a.aan = !aan;
  }
  setTimeout(() => {
    laadApparaten();
    laadHuis();
  }, 700);
}

/** De knoppen onderin: zelf gekozen in Apparaten of het tandwiel, en anders alle scènes. */
function tekenScenes() {
  const gekozen = staat.inst?.snelkoppelingen ?? [];
  if (gekozen.length) {
    const knoppen = gekozen.map((id) => staat.apparaten?.find((a) => a.id === id)).filter((a): a is Apparaat => !!a);
    $('scenes-pil').hidden = knoppen.length === 0;
    $('scenes').replaceChildren(
      ...knoppen.map((a) => {
        const knop = maak('button', a.bediening === 'schakel' && a.aan ? 'actief-warm' : undefined, a.naam);
        knop.type = 'button';
        if (a.bediening === 'schakel') knop.setAttribute('aria-pressed', String(!!a.aan));
        knop.disabled = !a.bereikbaar;
        knop.addEventListener('click', () => {
          if (a.bediening === 'start') {
            knop.classList.add('actief-warm');
            setTimeout(() => knop.classList.remove('actief-warm'), 1200);
          }
          bedienApparaat(a, a.bediening === 'start' ? true : !a.aan);
        });
        return knop;
      }),
    );
    return;
  }
  const scenes = staat.huis?.scenes ?? [];
  $('scenes-pil').hidden = scenes.length === 0;
  $('scenes').replaceChildren(
    ...scenes.map((s) => {
      const knop = maak('button', undefined, s.naam);
      knop.type = 'button';
      knop.addEventListener('click', async () => {
        knop.classList.add('actief-warm');
        try {
          await fetch(`/api/scene/${encodeURIComponent(s.id)}`, { method: 'POST' });
        } finally {
          setTimeout(() => knop.classList.remove('actief-warm'), 1200);
          setTimeout(laadHuis, 800);
        }
      });
      return knop;
    }),
  );
}

function tekenFavorieten() {
  const ids = staat.inst?.favorieten ?? [];
  if (!ids.length) {
    $('favorieten').replaceChildren(maak('p', 'muted klein', 'Geef lampen een ster bij Apparaten, dan staan ze hier.'));
    return;
  }
  if (!staat.apparaten) {
    $('favorieten').replaceChildren(maak('p', 'muted klein', 'Laden…'));
    return;
  }
  $('favorieten').replaceChildren(
    ...ids
      .map((id) => staat.apparaten!.find((a) => a.id === id))
      .filter((a): a is Apparaat => !!a)
      .map((a) => {
        const tegel = maak('button', 'favoriet' + (a.aan ? ' aan' : ''));
        tegel.type = 'button';
        tegel.disabled = !a.bereikbaar;
        if (a.bediening === 'schakel') tegel.setAttribute('aria-pressed', String(!!a.aan));
        tegel.append(maak('span', 'favoriet-lamp'), maak('strong', undefined, a.naam), maak('span', 'muted klein', a.bereikbaar ? a.tekst || 'Starten' : 'Niet bereikbaar'));
        tegel.addEventListener('click', () => bedienApparaat(a, a.bediening === 'start' ? true : !a.aan));
        return tegel;
      }),
  );
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
    if (antwoord.ok) zetInst(await antwoord.json());
  } catch (fout) {
    console.error('Bewaren mislukt', fout);
  }
}

let cameraGetoond = '';
function tekenCamera(verversen = false) {
  const cameras = staat.huis?.cameras ?? [];
  const camera = cameras[staat.camera % Math.max(cameras.length, 1)];
  const wissel = $<HTMLButtonElement>('camera-wissel');
  wissel.hidden = cameras.length < 2;
  tekst(wissel, camera ? `${camera.naam} ›` : '');
  tekst($('camera-naam'), camera?.naam ?? 'camera');
  const beeld = $<HTMLImageElement>('camera-beeld');
  if (!camera || staat.huis?.bron !== 'home-assistant') {
    beeld.hidden = true;
  } else if (verversen || cameraGetoond !== camera.id) {
    cameraGetoond = camera.id;
    beeld.alt = `Camerabeeld ${camera.naam}`;
    beeld.src = `/api/camera/${encodeURIComponent(camera.id)}?t=${Date.now()}`;
  }
  const beweging = $('beweging');
  beweging.parentElement!.hidden = !camera?.beweging;
  if (camera?.beweging) tekst(beweging, `Beweging om ${uur(camera.beweging)}`);
}

function tekenWeer() {
  const weer = staat.huis?.weer ?? staat.overzicht?.weer;
  tekst($('weer'), weer ? `${weer.temperatuur != null ? `${Math.round(weer.temperatuur)} °C ` : ''}${weer.omschrijving.toLowerCase()}` : '');
}

function tekenOpmerking() {
  const opmerking = $('voorbeeld');
  if (staat.huis?.bron === 'voorbeeld') tekst(opmerking, 'Voorbeeldgegevens · stel Home Assistant in om je eigen huis te zien');
  else tekst(opmerking, 'Agenda en mail zijn nog voorbeeld · koppel Google via het tandwiel');
  opmerking.hidden = !staat.overzicht?.voorbeeld && staat.huis?.bron !== 'voorbeeld';
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
}

// Schermen en blokken uit het tandwiel.
function pasToe() {
  const blokken = staat.inst?.blokken ?? {};
  document.querySelectorAll<HTMLElement>('[data-blok]').forEach((el) => el.classList.toggle('uit', blokken[el.dataset.blok!] === false));
  const overzicht = staat.scherm === 'overzicht';
  const pagina = staat.scherm === 'apparaten' || staat.scherm === 'cameras';
  const huisUit = blokken.huis === false;
  const achter = overzicht || pagina || (huisUit && !staat.huisVoor);
  const app = document.querySelector('.app')!;
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
  $('huis-knop-pil').hidden = pagina || (!achter && !(huisUit && staat.huisVoor));
  $('huis-knop').setAttribute('aria-pressed', String(!achter));
  $('huis-knop').setAttribute('aria-label', achter ? 'Huis naar voren halen' : 'Huis naar achteren');
  tekst($('scherm-label'), `ATLAS · ${{ thuis: 'THUIS', overzicht: 'OVERZICHT', apparaten: 'APPARATEN', cameras: "CAMERA'S" }[staat.scherm]}`);
  document.querySelectorAll<HTMLButtonElement>('[data-scherm]').forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.scherm === staat.scherm)));
}

const apparaten = maakApparaten(() => laadHuis(), {
  heeft: (lijst, id) => !!staat.inst?.[lijst].includes(id),
  wissel: wisselLijst,
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
  const lijst = (staat.inst?.belangrijk ?? []).filter((d) => middag(d.datum) >= vandaag).slice(0, 4);
  if (lijst.length === 0) {
    $('belangrijk').replaceChildren(maak('p', 'muted klein', 'Voeg data toe via het tandwiel.'));
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
        if (dagen <= 7) rij.classList.add('dringend');
        teller = dagen === 0 ? 'vandaag' : dagen === 1 ? 'morgen' : `nog ${dagen} dagen`;
        detail = datum;
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
type Melding = { volg: number; titel: string; tekst: string; beeld: string | null };
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
    if (laatsteMelding != null && data.laatste >= laatsteMelding) data.meldingen.slice(-3).forEach(toonMelding);
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
      if (j.nieuw?.length) {
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
      const tegels = maak('div', 'tegels');
      for (const [n, naam, warm] of [
        [z.wachtend ?? 0, 'wachten', true],
        [z.bezig ?? 0, 'bezig', false],
        [z.beschikbaar ?? 0, 'beschikbaar', false],
      ] as const) {
        const t = maak('div', 'tegel' + (warm && n > 0 ? ' warm' : ''));
        t.append(maak('span', 'mono tegel-getal', String(n)), maak('span', 'muted klein', naam));
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

function zetInst(inst: Instellingen, eerste = false) {
  // Het huis net uitgezet of weer aangezet: dan geldt de nieuwe stand meteen.
  if (inst.blokken.huis !== staat.inst?.blokken.huis) staat.huisVoor = false;
  staat.inst = inst;
  if (eerste) staat.scherm = inst.start[matchMedia('(max-width: 1000px)').matches ? 'smal' : 'breed'];
  pasToe();
  tekenBelangrijk();
  tekenFavorieten();
  tekenScenes();
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
    staat.modus = knop.dataset.modus as '2d' | '3d';
    tekenAlles();
  });
});
let laatsteScroll = 0;
$('huis').addEventListener(
  'wheel',
  (e) => {
    if (document.querySelector('.app')!.classList.contains('huis-achter') || Math.abs(e.deltaY) < 4) return;
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
$<HTMLSelectElement>('kamer-keuze').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value || null;
  staat.kamer = id;
  staat.gekozen = id && id !== LOS ? (ruimteBij(id)?.id ?? null) : null;
  tekenAlles();
});
$('camera-wissel').addEventListener('click', () => {
  staat.camera += 1;
  tekenCamera();
});
$<HTMLImageElement>('camera-beeld').addEventListener('load', (e) => ((e.target as HTMLImageElement).hidden = false));
$<HTMLImageElement>('camera-beeld').addEventListener('error', (e) => ((e.target as HTMLImageElement).hidden = true));

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
tekenAlles();
laadOverzicht();
setInterval(laadOverzicht, 60_000);
laadHuis();
setInterval(laadHuis, 5_000);
setInterval(() => document.visibilityState === 'visible' && tekenCamera(true), 10_000);
