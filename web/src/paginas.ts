// De schermen Apparaten (alles uit Home Assistant per ruimte) en Camera's (alle camera's tegelijk).
type Apparaat = {
  id: string;
  naam: string;
  soort: string;
  tekst: string;
  aan: boolean | null;
  bediening: 'schakel' | 'start' | null;
  bereikbaar: boolean;
};
type Apparaten = { ruimtes: { id: string; naam: string; verdieping: string | null; apparaten: Apparaat[] }[]; overig: Apparaat[] };
type Camera = { id: string; naam: string };

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

export function maakApparaten(opVerandering: () => void) {
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
    if (!staat.bezig.size) teken();
  }

  teken();
  return { laad };
}

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
              groot.showModal();
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
  document.getElementById('camera-groot-sluit')!.addEventListener('click', () => groot.close());
  groot.addEventListener('click', (e) => e.target === groot && groot.close());
  groot.addEventListener('close', () => (open = null));

  return { zet, ververs };
}
