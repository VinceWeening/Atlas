import { mediaBediening, mediaTekst, type Media } from './media';
import { post } from './melding';

type Remote = { id: string; naam: string; bereikbaar: boolean };
const TOETSEN = {
  HOME: ['Home', 'Home'],
  BACK: ['Terug', 'Terug'],
  DPAD_UP: ['Omhoog', '↑'],
  DPAD_DOWN: ['Omlaag', '↓'],
  DPAD_LEFT: ['Links', '←'],
  DPAD_RIGHT: ['Rechts', '→'],
  DPAD_CENTER: ['OK', 'OK'],
  VOLUME_UP: ['Harder', 'Volume +'],
  VOLUME_DOWN: ['Zachter', 'Volume −'],
  VOLUME_MUTE: ['Geluid dempen of herstellen', 'Dempen'],
  MEDIA_PLAY_PAUSE: ['Afspelen of pauzeren', 'Speel / pauze'],
  POWER: ['Tv aan of uit', 'Aan / uit'],
} as const;
type Toets = keyof typeof TOETSEN;
const APPS = { youtube: 'YouTube', netflix: 'Netflix', prime: 'Prime Video', disney: 'Disney+' } as const;
const PICTOGRAMMEN: Partial<Record<Toets, string>> = {
  HOME: '<path d="m3 10 9-7 9 7M5 9v11h14V9m-9 11v-6h4v6"/>',
  BACK: '<path d="m9 6-5 5 5 5M4 11h10a5 5 0 0 1 5 5v2"/>',
  POWER: '<path d="M12 3v8M7 6a8 8 0 1 0 10 0"/>',
  DPAD_UP: '<path d="m7 14 5-5 5 5"/>',
  DPAD_DOWN: '<path d="m7 10 5 5 5-5"/>',
  DPAD_LEFT: '<path d="m14 7-5 5 5 5"/>',
  DPAD_RIGHT: '<path d="m10 7 5 5-5 5"/>',
  VOLUME_UP: '<path d="M6 12h12m-6-6v12"/>',
  VOLUME_DOWN: '<path d="M6 12h12"/>',
  VOLUME_MUTE: '<path d="M4 9h4l4-4v14l-4-4H4zm12 1 4 4m0-4-4 4"/>',
  MEDIA_PLAY_PAUSE: '<path d="m4 6 9 6-9 6zM16 6v12m4-12v12"/>',
};
type App = keyof typeof APPS;
type Opdracht = { toets: Toets } | { app: App };
const PIJLEN: Record<string, Toets> = { ArrowUp: 'DPAD_UP', ArrowDown: 'DPAD_DOWN', ArrowLeft: 'DPAD_LEFT', ArrowRight: 'DPAD_RIGHT' };

async function lijst<T>(url: string): Promise<T[]> {
  const antwoord = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!antwoord.ok) throw new Error('Tv-gegevens niet bereikbaar');
  return antwoord.json();
}

export function maakTvBediening() {
  const venster = document.querySelector<HTMLDialogElement>('#tv-dialog')!;
  const keuze = document.querySelector<HTMLSelectElement>('#tv-keuze')!;
  const bediening = document.getElementById('tv-bediening')!;
  const status = document.getElementById('tv-status')!;
  let remotes: Remote[] = [];
  let spelers: Media[] = [];
  let laatst = '';
  let sessie = 0;
  let rij: { id: string; actie: Opdracht; sessie: number }[] = [];
  let bezig = false;
  try { laatst = localStorage.getItem('atlas-tv-keuze') ?? ''; } catch { /* Optioneel. */ }

  async function verstuur(id: string, actie: Opdracht) {
    if (!venster.open || keuze.value !== id || rij.length >= 6) return;
    rij.push({ id, actie, sessie });
    if (bezig) return;
    bezig = true;
    while (rij.length) {
      const opdracht = rij.shift()!;
      if (opdracht.sessie !== sessie) continue;
      const label = 'toets' in opdracht.actie ? TOETSEN[opdracht.actie.toets][0] : APPS[opdracht.actie.app];
      status.textContent = `${label} verzenden…`;
      try {
        await post(`/api/tv-remotes/${encodeURIComponent(opdracht.id)}`, opdracht.actie);
        if (opdracht.sessie === sessie) status.textContent = `${label} verzonden`;
      } catch {
        if (opdracht.sessie === sessie) {
          rij = [];
          status.textContent = 'De tv reageert niet. Probeer opnieuw.';
        }
      }
    }
    bezig = false;
  }

  function groep(id: string, klasse: string, label: string, toetsen: Toets[]) {
    const vak = document.createElement('div');
    vak.className = klasse;
    vak.setAttribute('role', 'group');
    vak.setAttribute('aria-label', label);
    for (const toets of toetsen) {
      const knop = document.createElement('button');
      knop.type = 'button';
      knop.className = 'tv-toets';
      knop.dataset.toets = toets;
      knop.setAttribute('aria-label', TOETSEN[toets][0]);
      const icoon = PICTOGRAMMEN[toets];
      if (icoon) {
        knop.innerHTML = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icoon}</svg>`;
      }
      if (!icoon || !toets.startsWith('DPAD_')) {
        const tekst = document.createElement('span');
        tekst.textContent = TOETSEN[toets][1];
        knop.append(tekst);
      }
      knop.addEventListener('click', () => void verstuur(id, { toets }));
      vak.append(knop);
    }
    return vak;
  }

  function snelkoppelingen(id: string) {
    const sleutel = `atlas-tv-snelkoppelingen:${id}`;
    let gekozen: App[] = ['youtube', 'netflix'];
    try {
      const opgeslagen = JSON.parse(localStorage.getItem(sleutel) ?? 'null');
      if (Array.isArray(opgeslagen)) gekozen = opgeslagen.filter((app): app is App => typeof app === 'string' && Object.hasOwn(APPS, app));
    } catch { /* Gebruik de standaardkeuze. */ }

    const vak = document.createElement('section');
    vak.className = 'tv-snelkoppelingen';
    const kop = document.createElement('h3');
    kop.textContent = 'Snelkoppelingen';
    const knoppen = document.createElement('div');
    knoppen.className = 'tv-rij';
    const bewerken = document.createElement('details');
    const open = document.createElement('summary');
    open.textContent = 'Aanpassen';
    bewerken.append(open);
    function tekenKnoppen() {
      knoppen.replaceChildren(...gekozen.map((app) => {
        const knop = document.createElement('button');
        knop.type = 'button';
        knop.className = 'tv-toets';
        knop.dataset.app = app;
        knop.textContent = APPS[app];
        knop.addEventListener('click', () => void verstuur(id, { app }));
        return knop;
      }));
    }
    for (const app of Object.keys(APPS) as App[]) {
      const regel = document.createElement('label');
      const keuze = document.createElement('input');
      keuze.type = 'checkbox';
      keuze.checked = gekozen.includes(app);
      keuze.addEventListener('change', () => {
        gekozen = keuze.checked ? [...gekozen, app] : gekozen.filter((id) => id !== app);
        try { localStorage.setItem(sleutel, JSON.stringify(gekozen)); }
        catch { status.textContent = 'Je browser kon de voorkeur niet opslaan.'; }
        tekenKnoppen();
      });
      regel.append(keuze, APPS[app]);
      bewerken.append(regel);
    }
    tekenKnoppen();
    vak.append(kop, bewerken, knoppen);
    return vak;
  }

  function teken() {
    bediening.replaceChildren();
    const remote = remotes.find(({ id }) => id === keuze.value);
    if (remote?.bereikbaar) {
      const vak = document.createElement('div');
      vak.className = 'tv-afstand';
      vak.append(
        groep(remote.id, 'tv-rij', 'Home en terug', ['BACK', 'HOME', 'POWER']),
        groep(remote.id, 'tv-pad', 'Richtingstoetsen', ['DPAD_UP', 'DPAD_LEFT', 'DPAD_CENTER', 'DPAD_RIGHT', 'DPAD_DOWN']),
        groep(remote.id, 'tv-rij tv-media', 'Geluid en afspelen', ['VOLUME_DOWN', 'VOLUME_UP', 'VOLUME_MUTE', 'MEDIA_PLAY_PAUSE']),
        snelkoppelingen(remote.id),
      );
      bediening.append(vak);
      return;
    }
    const speler = spelers.find(({ id }) => id === keuze.value);
    if (speler?.bereikbaar) {
      const nu = sessie;
      const tekst = document.createElement('p');
      tekst.className = 'muted klein';
      tekst.textContent = mediaTekst(speler.media).titel;
      const knoppen = mediaBediening(speler, async () => {
        if (nu !== sessie || !venster.open) return;
        try {
          const nieuw = await lijst<Media>('/api/media');
          if (nu !== sessie || !venster.open) return;
          spelers = nieuw;
          teken();
        } catch {
          if (nu === sessie) status.textContent = 'Tv-status kon niet worden vernieuwd.';
        }
      });
      bediening.append(tekst);
      if (knoppen) bediening.append(knoppen);
      status.textContent = 'Mediabediening. Voor pijlen en Home is een Android TV-koppeling nodig.';
    } else if (keuze.value) {
      status.textContent = 'Deze tv is niet bereikbaar.';
    }
  }

  document.getElementById('tv-open')!.addEventListener('click', async () => {
    const nu = ++sessie;
    bediening.replaceChildren();
    keuze.replaceChildren();
    keuze.disabled = true;
    status.textContent = 'Tv’s ophalen…';
    venster.showModal();
    const [afstand, media] = await Promise.allSettled([lijst<Remote>('/api/tv-remotes'), lijst<Media>('/api/media')]);
    if (nu !== sessie || !venster.open) return;
    remotes = afstand.status === 'fulfilled' ? afstand.value : [];
    spelers = media.status === 'fulfilled' ? media.value.filter(({ id, naam }) => /(?:^|[\s_.-])(?:tv|beamer|televisie|googletv)(?:[\s_.\d-]|$)/i.test(`${id} ${naam}`)) : [];
    const nativeNamen = new Set(remotes.filter((remote) => remote.bereikbaar).map((remote) => remote.naam.toLowerCase()));
    const zichtbaar = [
      ...remotes.map((remote) => ({ ...remote, label: remote.naam })),
      ...spelers.filter((speler) => !remotes.some((remote) => remote.id === speler.id) && !nativeNamen.has(speler.naam.toLowerCase()))
        .map((speler) => ({ ...speler, label: `${speler.naam} · media` })),
    ];
    if (!zichtbaar.length) {
      status.textContent = afstand.status === 'rejected' ? 'Tv’s konden niet worden opgehaald.' : 'Geen tv’s gevonden in Home Assistant.';
      return;
    }
    for (const tv of zichtbaar) keuze.add(new Option(tv.bereikbaar ? tv.label : `${tv.label} · offline`, tv.id));
    keuze.value = zichtbaar.some(({ id }) => id === laatst) ? laatst : (zichtbaar.find((tv) => tv.bereikbaar) ?? zichtbaar[0]).id;
    keuze.disabled = false;
    status.textContent = '';
    teken();
    if (matchMedia('(pointer: fine)').matches && document.activeElement?.id === 'tv-sluit') {
      bediening.querySelector<HTMLButtonElement>('[data-toets="DPAD_CENTER"]')?.focus();
    }
  });
  keuze.addEventListener('change', () => {
    sessie++;
    rij = [];
    laatst = keuze.value;
    try { localStorage.setItem('atlas-tv-keuze', laatst); } catch { /* Optioneel. */ }
    status.textContent = '';
    teken();
  });
  venster.addEventListener('keydown', (event) => {
    const doel = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || doel.matches('select, input')) return;
    const toets = PIJLEN[event.key];
    if (!toets || !remotes.some((remote) => remote.id === keuze.value && remote.bereikbaar)) return;
    event.preventDefault();
    if (!event.repeat) void verstuur(keuze.value, { toets });
  });
  document.getElementById('tv-sluit')!.addEventListener('click', () => venster.close());
  venster.addEventListener('close', () => { sessie++; rij = []; });
}
