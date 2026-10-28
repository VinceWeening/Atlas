import './styles.css';
import { lagen, type Ruimte } from './huis';
import { instellingen } from './instellingen';

type Overzicht = {
  voorbeeld: boolean;
  weer: { omschrijving: string; temperatuur: number };
  agenda: { tijd: string; titel: string; detail: string; kleur?: string | null }[];
  morgen: string;
  mail: { van: string; onderwerp: string; link?: string }[];
  mailAantal?: number;
  agendaFout?: boolean;
  mailFout?: boolean;
  google?: { ingesteld: boolean; gekoppeld: boolean };
};
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
    const naam = maak('span', 'lbl laag-naam', laag.label);
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

function tekenKnoppen() {
  const opties = [{ id: 'alle', naam: 'Alles' }, ...lagen.map((l) => ({ id: l.id, naam: l.id === 'v1' ? '1e' : l.naam }))];
  $('verdiepingen').replaceChildren(
    ...opties.map((o) => {
      const knop = maak('button', undefined, o.naam);
      knop.type = 'button';
      knop.setAttribute('aria-pressed', String(staat.verdieping === o.id));
      knop.addEventListener('click', () => {
        staat.verdieping = o.id;
        tekenAlles();
      });
      return knop;
    }),
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

function tekenScenes() {
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
  tekst($('mail-aantal'), o.mailFout ? 'niet bereikbaar' : o.voorbeeld ? `${aantal} ongelezen` : `${aantal} belangrijk`);
  $('mail').replaceChildren(
    ...(o.mail.length === 0 && !o.mailFout ? [maak('p', 'muted klein', 'Geen belangrijke mail.')] : []),
    ...o.mail.map((m) => {
      const rij = maak(m.link ? 'a' : 'div', 'mailregel');
      if (m.link && rij instanceof HTMLAnchorElement) {
        rij.href = m.link;
        rij.target = '_blank';
        rij.rel = 'noopener';
      }
      rij.append(maak('strong', undefined, m.van), maak('span', 'muted', m.onderwerp));
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
}

document.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((knop) => {
  knop.addEventListener('click', () => {
    staat.modus = knop.dataset.modus as '2d' | '3d';
    tekenAlles();
  });
});
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

instellingen(laadOverzicht);
tikKlok();
setInterval(tikKlok, 1000);
tekenAlles();
laadOverzicht();
setInterval(laadOverzicht, 60_000);
laadHuis();
setInterval(laadHuis, 5_000);
setInterval(() => document.visibilityState === 'visible' && tekenCamera(true), 10_000);
