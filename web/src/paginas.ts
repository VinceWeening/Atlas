// De schermen Apparaten (alles uit Home Assistant per ruimte) en Camera's (alle camera's tegelijk).
import { lampSchuiven, schuiftNu, type LampDelen } from './lamp';

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
type Apparaten = { ruimtes: { id: string; naam: string; verdieping: string | null; apparaten: Apparaat[] }[]; overig: Apparaat[] };
type Camera = { id: string; naam: string };
type CameraOptie = {
  id: string;
  naam: string;
  soort: 'switch' | 'light' | 'siren' | 'select' | 'number' | 'button';
  aan: boolean | null;
  waarde: string | number | null;
  keuzes?: string[];
  min?: number;
  max?: number;
  stap?: number;
  eenheid?: string;
  bereikbaar: boolean;
};

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

const FILTERS: [string, string, string[] | null][] = [
  ['alles', 'Alles', null],
  ['lampen', 'Lampen', ['light']],
  ['schakelaars', 'Schakelaars', ['switch', 'fan', 'input_boolean', 'cover']],
  ['sensoren', 'Sensoren', ['sensor', 'binary_sensor', 'climate', 'weather', 'lock']],
  ['media', 'Media', ['media_player', 'vacuum']],
  ['scenes', 'Scènes', ['scene', 'script']],
  ['personen', 'Personen', ['person']],
];

const staat = { filter: 'alles', zoek: '', data: null as Apparaten | null, fout: false, bezig: new Set<string>() };

type Lijsten = { heeft: (lijst: 'favorieten' | 'snelkoppelingen', id: string) => boolean; wissel: (lijst: 'favorieten' | 'snelkoppelingen', id: string) => Promise<void> };

const STER = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';
const ONDERIN = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="15" width="18" height="6" rx="3"/><path d="M12 3v8m-3.5-3.5L12 11l3.5-3.5"/></svg>';

export function maakApparaten(opVerandering: () => void, lijsten: Lijsten) {
  const pagina = document.getElementById('pagina-apparaten')!;
  const zoek = pagina.querySelector<HTMLInputElement>('#apparaten-zoek')!;
  const filters = pagina.querySelector<HTMLElement>('#apparaten-filters')!;
  const lijst = pagina.querySelector<HTMLElement>('#apparaten-lijst')!;

  for (const [id, naam] of FILTERS) {
    const knop = maak('button', undefined, naam);
    knop.type = 'button';
    knop.dataset.filter = id;
    knop.addEventListener('click', () => {
      staat.filter = id;
      teken();
    });
    filters.append(knop);
  }
  zoek.addEventListener('input', () => {
    staat.zoek = zoek.value.trim().toLowerCase();
    teken();
  });

  async function bedien(a: Apparaat, aan: boolean) {
    staat.bezig.add(a.id);
    if (a.bediening === 'schakel') a.aan = aan; // meteen tonen, de volgende ronde bevestigt het
    teken();
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
    staat.bezig.delete(a.id);
    setTimeout(() => {
      laad();
      opVerandering();
    }, 600);
  }

  function rij(a: Apparaat) {
    const r = maak('div', 'lamp apparaat' + (a.bereikbaar ? '' : ' weg'));
    const info = maak('div', 'lamp-info');
    const namen = maak('span');
    namen.append(a.naam, ...(a.tekst ? [maak('small', undefined, a.tekst)] : []));
    info.append(namen);
    r.append(info);
    if (a.bediening) {
      // Ster: op de kaart Favorieten. Pijl: als knop onderin.
      for (const [lijst, icoon, label] of [
        ['favorieten', STER, 'favorieten'],
        ['snelkoppelingen', ONDERIN, 'de knoppen onderin'],
      ] as const) {
        const aan = lijsten.heeft(lijst, a.id);
        const k = maak('button', 'icoon-knop' + (aan ? ' aan' : ''));
        k.type = 'button';
        k.innerHTML = icoon;
        k.setAttribute('aria-pressed', String(aan));
        k.setAttribute('aria-label', `${a.naam} ${aan ? 'weghalen uit' : 'toevoegen aan'} ${label}`);
        k.title = aan ? `Weghalen uit ${label}` : `Toevoegen aan ${label}`;
        k.addEventListener('click', async () => {
          await lijsten.wissel(lijst, a.id);
          teken();
        });
        r.append(k);
      }
    }
    if (a.bediening === 'schakel') {
      const s = maak('button', 'schakelaar');
      s.type = 'button';
      s.setAttribute('role', 'switch');
      s.setAttribute('aria-checked', String(!!a.aan));
      s.setAttribute('aria-label', `${a.naam} ${a.aan ? 'uitzetten' : 'aanzetten'}`);
      s.disabled = !a.bereikbaar || staat.bezig.has(a.id);
      s.addEventListener('click', () => bedien(a, !a.aan));
      r.append(s);
    } else if (a.bediening === 'start') {
      const k = maak('button', 'knop zacht', 'Start');
      k.type = 'button';
      k.setAttribute('aria-label', `${a.naam} starten`);
      k.disabled = staat.bezig.has(a.id);
      k.addEventListener('click', () => bedien(a, true));
      r.append(k);
    }
    const schuiven = lampSchuiven(a, () => setTimeout(laad, 400));
    if (schuiven) r.append(schuiven);
    return r;
  }

  function past(a: Apparaat, ruimte: string) {
    const soorten = FILTERS.find(([id]) => id === staat.filter)?.[2];
    if (soorten && !soorten.includes(a.soort)) return false;
    return !staat.zoek || `${a.naam} ${ruimte} ${a.id}`.toLowerCase().includes(staat.zoek);
  }

  function teken() {
    filters.querySelectorAll<HTMLButtonElement>('button').forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.filter === staat.filter)));
    if (!staat.data) {
      lijst.replaceChildren(maak('p', 'muted', staat.fout ? 'Home Assistant is niet bereikbaar.' : 'Laden…'));
      return;
    }
    const groepen = [...staat.data.ruimtes, ...(staat.data.overig.length ? [{ id: '__overig', naam: 'Zonder ruimte', verdieping: null, apparaten: staat.data.overig }] : [])];
    const kaarten = groepen
      .map((g) => ({ ...g, apparaten: g.apparaten.filter((a) => past(a, g.naam)) }))
      .filter((g) => g.apparaten.length)
      .map((g) => {
        const kaart = maak('section', 'gl ruimte-kaart');
        const binnen = maak('div', 'gl-in paneel');
        const kop = maak('div', 'kop');
        kop.append(maak('h2', 'kamer-naam', g.naam), maak('span', 'lbl', (g.verdieping ?? '').toUpperCase()));
        binnen.append(kop, ...g.apparaten.map(rij));
        kaart.append(binnen);
        return kaart;
      });
    lijst.replaceChildren(...(kaarten.length ? kaarten : [maak('p', 'muted', 'Niets gevonden.')]));
  }

  async function laad() {
    try {
      const antwoord = await fetch('/api/apparaten');
      if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
      staat.data = await antwoord.json();
      staat.fout = false;
    } catch {
      staat.fout = true;
    }
    // Niet opnieuw tekenen terwijl iemand een schakelaar indrukt.
    if (!staat.bezig.size && !schuiftNu()) teken();
  }

  teken();
  return { laad };
}

type Opname = { id: string; camera: string; titel: string; tijd: string; duur: number | null; beeld: string; video: string };

const wanneer = (iso: string) => {
  const d = new Date(iso);
  const tijd = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `vandaag ${tijd}`;
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return `gisteren ${tijd}`;
  return `${d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} ${tijd}`;
};

export function maakCameras() {
  const lijst = document.getElementById('cameras-lijst')!;
  const groot = document.getElementById('camera-groot') as HTMLDialogElement;
  const grootBeeld = document.getElementById('camera-groot-beeld') as HTMLImageElement;
  const grootNaam = document.getElementById('camera-groot-naam')!;
  let cameras: Camera[] = [];
  let open: Camera | null = null;

  const adres = (c: Camera) => `/api/camera/${encodeURIComponent(c.id)}?t=${Date.now()}`;

  function zet(cameraLijst: Camera[]) {
    const sleutel = cameraLijst.map((c) => c.id).join();
    if (sleutel === cameras.map((c) => c.id).join()) return;
    cameras = cameraLijst;
    lijst.replaceChildren(
      ...(cameras.length
        ? cameras.map((c) => {
            const tegel = maak('button', 'gl camera-tegel');
            tegel.type = 'button';
            tegel.dataset.camera = c.id;
            tegel.setAttribute('aria-label', `${c.naam} groot bekijken`);
            const beeld = maak('img');
            beeld.alt = `Camerabeeld ${c.naam}`;
            beeld.addEventListener('error', () => beeld.classList.add('leeg'));
            beeld.addEventListener('load', () => beeld.classList.remove('leeg'));
            tegel.append(beeld, maak('span', 'lbl camera-tegel-naam', c.naam.toUpperCase()));
            tegel.addEventListener('click', () => {
              open = c;
              grootNaam.textContent = c.naam;
              grootBeeld.src = adres(c);
              grootBeeld.alt = `Camerabeeld ${c.naam}`;
              optiesVak.replaceChildren(maak('p', 'muted klein', 'Instellingen laden…'));
              groot.showModal();
              laadOpties(c);
            });
            return tegel;
          })
        : [maak('p', 'muted', 'Geen camera’s gevonden in Home Assistant.')]),
    );
    ververs();
  }

  /** Nieuwe beelden halen; alleen voor wat er in beeld is. */
  function ververs() {
    for (const c of cameras) {
      const img = lijst.querySelector<HTMLImageElement>(`[data-camera="${CSS.escape(c.id)}"] img`);
      if (img) img.src = adres(c);
    }
  }

  setInterval(() => {
    if (open && groot.open) grootBeeld.src = adres(open);
  }, 2000);

  // Instellingen van de camera zelf naast het grote beeld: IR-licht, nachtzicht, sirene, Frigate-detectie en zo.
  const optiesVak = document.getElementById('camera-groot-opties')!;
  let optiesBezig = false;
  let optieVast = false;
  optiesVak.addEventListener('pointerdown', () => (optieVast = true));
  window.addEventListener('pointerup', () => (optieVast = false));

  async function laadOpties(c: Camera) {
    try {
      const antwoord = await fetch(`/api/camera/${encodeURIComponent(c.id)}/opties`);
      if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
      const { opties } = (await antwoord.json()) as { opties: CameraOptie[] };
      if (open?.id === c.id && !optiesBezig && !optieVast && optiesVak.querySelector('select:focus') == null) tekenOpties(c, opties);
    } catch {
      if (open?.id === c.id) optiesVak.replaceChildren(maak('p', 'muted klein', 'Instellingen van de camera niet bereikbaar.'));
    }
  }

  async function zetOptie(c: Camera, o: CameraOptie, waarde: boolean | string | number | null) {
    optiesBezig = true;
    try {
      const antwoord = await fetch(`/api/camera/${encodeURIComponent(c.id)}/opties/${encodeURIComponent(o.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ waarde }),
      });
      if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    } catch (fout) {
      console.error('Camera-instelling mislukt', fout);
    }
    optiesBezig = false;
    setTimeout(() => open?.id === c.id && laadOpties(c), 700);
  }

  function tekenOpties(c: Camera, opties: CameraOptie[]) {
    if (!opties.length) {
      optiesVak.replaceChildren(
        maak('h3', 'lbl', 'INSTELLINGEN'),
        maak('p', 'muted klein', 'Home Assistant heeft geen schakelaars of standen bij deze camera. Zit de camera-integratie (bijvoorbeeld Reolink, Tapo of ONVIF) er wel in, dan verschijnen IR-licht en nachtzicht hier vanzelf.'),
      );
      return;
    }
    const rijen = opties.map((o) => {
      const r = maak('div', 'lamp apparaat' + (o.bereikbaar ? '' : ' weg'));
      const info = maak('div', 'lamp-info');
      const namen = maak('span');
      namen.append(o.naam);
      info.append(namen);
      r.append(info);
      if (o.soort === 'select' && o.keuzes) {
        const keuze = maak('select', 'kamer-keuze keuze');
        keuze.setAttribute('aria-label', o.naam);
        keuze.disabled = !o.bereikbaar;
        keuze.append(...o.keuzes.map((k) => Object.assign(maak('option', undefined, k), { value: k })));
        keuze.value = String(o.waarde ?? '');
        keuze.addEventListener('change', () => zetOptie(c, o, keuze.value));
        r.append(keuze);
      } else if (o.soort === 'number') {
        const vak = maak('label', 'schuif');
        const invoer = maak('input');
        invoer.type = 'range';
        invoer.min = String(o.min ?? 0);
        invoer.max = String(o.max ?? 100);
        invoer.step = String(o.stap ?? 1);
        invoer.value = String(o.waarde ?? o.min ?? 0);
        invoer.disabled = !o.bereikbaar;
        invoer.setAttribute('aria-label', o.naam);
        const tekst = (w: string) => `${Number(w).toLocaleString('nl-NL')}${o.eenheid ? ` ${o.eenheid}` : ''}`;
        const waarde = maak('span', 'schuif-waarde', tekst(invoer.value));
        const vul = () => invoer.style.setProperty('--vul', `${((Number(invoer.value) - Number(invoer.min)) / (Number(invoer.max) - Number(invoer.min) || 1)) * 100}%`);
        vul();
        invoer.addEventListener('input', () => {
          waarde.textContent = tekst(invoer.value);
          vul();
        });
        invoer.addEventListener('change', () => zetOptie(c, o, Number(invoer.value)));
        vak.append(invoer, waarde);
        r.append(vak);
      } else if (o.soort === 'button') {
        const k = maak('button', 'knop zacht', 'Uitvoeren');
        k.type = 'button';
        k.disabled = !o.bereikbaar;
        k.setAttribute('aria-label', `${o.naam} uitvoeren`);
        k.addEventListener('click', () => zetOptie(c, o, null));
        r.append(k);
      } else {
        const s = maak('button', 'schakelaar');
        s.type = 'button';
        s.setAttribute('role', 'switch');
        s.setAttribute('aria-checked', String(!!o.aan));
        s.setAttribute('aria-label', `${o.naam} ${o.aan ? 'uitzetten' : 'aanzetten'}`);
        s.disabled = !o.bereikbaar;
        s.addEventListener('click', () => {
          // Een sirene gaat niet per ongeluk af.
          if (o.soort === 'siren' && !o.aan && !confirm(`${o.naam} aanzetten? Dat maakt veel lawaai.`)) return;
          s.setAttribute('aria-checked', String(!o.aan));
          zetOptie(c, o, !o.aan);
        });
        r.append(s);
      }
      return r;
    });
    optiesVak.replaceChildren(maak('h3', 'lbl', 'INSTELLINGEN'), ...rijen);
  }

  setInterval(() => {
    if (open && groot.open) laadOpties(open);
  }, 10_000);

  // Terugkijken: de laatste opnames van Frigate, met een eigen videovenster.
  const opnamesLijst = document.getElementById('opnames-lijst')!;
  const videoVenster = document.getElementById('opname') as HTMLDialogElement;
  const video = document.getElementById('opname-video') as HTMLVideoElement;
  let opnamesSleutel = '';
  async function laadOpnames() {
    let opnames: Opname[] | null = null;
    try {
      const antwoord = await fetch('/api/opnames');
      if (antwoord.ok) opnames = await antwoord.json();
    } catch {
      // Hieronder een melding.
    }
    const sleutel = JSON.stringify(opnames?.map((o) => o.id) ?? null);
    if (sleutel === opnamesSleutel) return;
    opnamesSleutel = sleutel;
    if (!opnames) {
      opnamesLijst.replaceChildren(maak('p', 'muted klein', 'Frigate is niet gevonden of reageert niet.'));
      return;
    }
    if (!opnames.length) {
      opnamesLijst.replaceChildren(maak('p', 'muted klein', 'Nog geen opnames. Staat opnemen (record) aan in Frigate?'));
      return;
    }
    opnamesLijst.replaceChildren(
      ...opnames.map((o) => {
        const kaart = maak('button', 'gl opname-kaart');
        kaart.type = 'button';
        kaart.setAttribute('aria-label', `Opname ${o.titel} bij ${o.camera}, ${wanneer(o.tijd)} afspelen`);
        const beeld = maak('img');
        beeld.alt = '';
        beeld.loading = 'lazy';
        beeld.src = o.beeld;
        const speel = maak('span', 'opname-speel');
        speel.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
        const tekst = maak('span', 'opname-tekst');
        tekst.append(maak('strong', undefined, `${o.titel} · ${o.camera}`), maak('span', 'muted klein', `${wanneer(o.tijd)}${o.duur ? ` · ${o.duur} s` : ''}`));
        kaart.append(beeld, speel, tekst);
        kaart.addEventListener('click', () => {
          document.getElementById('opname-titel')!.textContent = `${o.titel} bij ${o.camera} · ${wanneer(o.tijd)}`;
          video.src = o.video;
          videoVenster.showModal();
          video.play().catch(() => {});
        });
        return kaart;
      }),
    );
  }
  document.getElementById('opname-sluit')!.addEventListener('click', () => videoVenster.close());
  videoVenster.addEventListener('click', (e) => e.target === videoVenster && videoVenster.close());
  videoVenster.addEventListener('close', () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
  document.getElementById('camera-groot-sluit')!.addEventListener('click', () => groot.close());
  groot.addEventListener('click', (e) => e.target === groot && groot.close());
  groot.addEventListener('close', () => (open = null));

  return { zet, ververs, laadOpnames };
}
