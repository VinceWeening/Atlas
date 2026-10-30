import { schuif, schuiftNu } from './lamp';
import { meldFout, post } from './melding';

// Tv's en speakers: wat er speelt, afspelen, volume en bron. Een andere bediening dan een schakelaar, want bij media
// wil je pauzeren en zachter zetten, niet alleen aan en uit. Wordt gebruikt op Overzicht (Speelt nu) en bij Apparaten.
export type MediaDelen = {
  staat: 'speelt' | 'pauze' | 'aan' | 'uit';
  titel: string | null;
  onder: string | null;
  app: string | null;
  volume: number | null;
  stil: boolean | null;
  bron: string | null;
  bronnen: string[];
  kan: { speel: boolean; vorige: boolean; volgende: boolean; volume: boolean; stappen: boolean; stil: boolean; bron: boolean; aan: boolean; uit: boolean };
  beeld: boolean;
};
type Media = { id: string; naam: string; bereikbaar: boolean; media: MediaDelen };
type Actie = 'speel' | 'vorige' | 'volgende' | 'volume' | 'harder' | 'zachter' | 'stil' | 'bron' | 'aan' | 'uit';

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

const svg = (pad: string) =>
  `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pad}</svg>`;
const BEELD = {
  speel: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pauze: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  vorige: svg('<path d="M6 5v14"/><path d="M19 5v14L9 12z" fill="currentColor"/>'),
  volgende: svg('<path d="M18 5v14"/><path d="M5 5v14l10-7z" fill="currentColor"/>'),
  geluid: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  stil: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>'),
  zachter: svg('<path d="M5 12h14"/>'),
  harder: svg('<path d="M5 12h14M12 5v14"/>'),
  aan: svg('<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'),
  tv: svg('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>'),
};

let bezig = 0;
/** Of er net iets bediend is; dan even niet opnieuw tekenen, anders springt de knop terug. */
export const mediaBezig = () => bezig > 0;

async function stuur(id: string, naam: string, actie: Actie, waarde?: number | boolean | string) {
  bezig++;
  try {
    await post(`/api/media/${encodeURIComponent(id)}`, waarde === undefined ? { actie } : { actie, waarde });
  } catch (fout) {
    console.error('Media bedienen mislukt', fout);
    meldFout(`${naam} reageert niet`);
  }
  setTimeout(() => (bezig = Math.max(0, bezig - 1)), 900);
}

function knop(beeld: string, label: string, klik: () => void, klasse = 'icoon-knop media-knop') {
  const k = maak('button', klasse);
  k.type = 'button';
  k.innerHTML = beeld;
  k.setAttribute('aria-label', label);
  k.title = label;
  k.addEventListener('click', klik);
  return k;
}

/** Wat er speelt, in één regel: titel, en daaronder serie of artiest en de app. */
export function mediaTekst(m: MediaDelen) {
  if (m.staat === 'uit') return { titel: 'Uit', onder: '' };
  const onder = [m.onder, m.app].filter(Boolean).join(' · ');
  if (m.titel) return { titel: m.titel, onder };
  return { titel: m.staat === 'pauze' ? 'Gepauzeerd' : m.app ?? 'Aan', onder: m.app && !m.titel ? '' : onder };
}

/**
 * De knoppen voor één tv of speaker: vorige, afspelen/pauze, volgende, geluid uit, volume en bron. Alleen wat het
 * apparaat zelf kan. Bij een apparaat dat uit staat alleen een aanknop. `na` laadt opnieuw na een bediening.
 */
export function mediaBediening(a: { id: string; naam: string; bereikbaar: boolean; media: MediaDelen }, na: () => void, metAanUit = true) {
  const m = a.media;
  const vak = maak('div', 'media-bediening');
  if (!a.bereikbaar) return null;
  const doe = (actie: Actie, waarde?: number | boolean | string) => async () => {
    await stuur(a.id, a.naam, actie, waarde);
    setTimeout(na, 500);
  };
  if (m.staat === 'uit') {
    if (!m.kan.aan || !metAanUit) return null;
    vak.append(knop(`${BEELD.aan}<span>Aanzetten</span>`, `${a.naam} aanzetten`, doe('aan'), 'knop zacht media-aan'));
    return vak;
  }
  const spelen = maak('div', 'media-spelen');
  if (m.kan.vorige) spelen.append(knop(BEELD.vorige, `Vorige op ${a.naam}`, doe('vorige')));
  if (m.kan.speel) {
    const speelt = m.staat === 'speelt';
    const k = knop(speelt ? BEELD.pauze : BEELD.speel, `${speelt ? 'Pauzeer' : 'Speel af op'} ${a.naam}`, () => {
      // Meteen omzetten; de volgende ronde bevestigt het.
      m.staat = speelt ? 'pauze' : 'speelt';
      k.innerHTML = speelt ? BEELD.speel : BEELD.pauze;
      k.setAttribute('aria-label', `${speelt ? 'Speel af op' : 'Pauzeer'} ${a.naam}`);
      void doe('speel')();
    }, 'media-speel');
    spelen.append(k);
  }
  if (m.kan.volgende) spelen.append(knop(BEELD.volgende, `Volgende op ${a.naam}`, doe('volgende')));
  if (spelen.childElementCount) vak.append(spelen);

  const geluid = maak('div', 'media-geluid');
  if (m.kan.stil) {
    const stil = !!m.stil;
    const k = knop(stil ? BEELD.stil : BEELD.geluid, stil ? `Geluid aan op ${a.naam}` : `Geluid uit op ${a.naam}`, doe('stil', !stil));
    k.setAttribute('aria-pressed', String(stil));
    geluid.append(k);
  }
  if (m.kan.volume && m.volume != null) {
    geluid.append(
      schuif({
        klasse: 'volume',
        label: `Volume ${a.naam}`,
        min: 0,
        max: 100,
        stap: 1,
        waarde: m.volume,
        tekst: (w) => `${w}%`,
        klaar: async (w) => {
          await stuur(a.id, a.naam, 'volume', w);
          setTimeout(na, 500);
        },
      }),
    );
  } else if (m.kan.stappen) {
    // Sommige tv's kennen alleen harder en zachter, zonder stand.
    geluid.append(knop(BEELD.zachter, `Zachter op ${a.naam}`, doe('zachter')), maak('span', 'lbl', 'Volume'), knop(BEELD.harder, `Harder op ${a.naam}`, doe('harder')));
  }
  if (geluid.childElementCount) vak.append(geluid);

  const onder = maak('div', 'media-onder');
  if (m.kan.bron) {
    const kies = maak('select', 'inst-veld media-bron');
    kies.setAttribute('aria-label', `Bron of app op ${a.naam}`);
    const lijst = m.bron && !m.bronnen.includes(m.bron) ? [m.bron, ...m.bronnen] : m.bronnen;
    if (!m.bron) kies.append(new Option('Kies een bron', '', true, true));
    for (const b of lijst) kies.append(new Option(b, b, false, b === m.bron));
    kies.addEventListener('change', () => kies.value && void doe('bron', kies.value)());
    onder.append(kies);
  }
  if (m.kan.uit && metAanUit) onder.append(knop(BEELD.aan, `${a.naam} uitzetten`, doe('uit'), 'icoon-knop media-knop media-uit'));
  if (onder.childElementCount) vak.append(onder);
  return vak;
}

/** Het blok Speelt nu op Overzicht: eerst wat speelt, daaronder in één regel wat uit staat. */
export function maakMediaBlok(blok: HTMLElement, lijst: HTMLElement) {
  let data: Media[] = [];
  let open: string | null = null;

  function kaart(x: Media) {
    const k = maak('div', `media-kaart staat-${x.media.staat}`);
    const kop = maak('div', 'media-kop');
    const hoes = maak('div', 'media-hoes');
    if (x.media.beeld) {
      const img = maak('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = `/api/media/${encodeURIComponent(x.id)}/beeld?t=${encodeURIComponent(x.media.titel ?? '')}`;
      img.addEventListener('error', () => hoes.replaceChildren(maakIcoon()));
      hoes.append(img);
    } else hoes.append(maakIcoon());
    const t = mediaTekst(x.media);
    const tekst = maak('div', 'media-tekst');
    tekst.append(maak('span', 'lbl', x.naam), maak('strong', undefined, t.titel), ...(t.onder ? [maak('small', undefined, t.onder)] : []));
    if (x.media.staat === 'speelt') kop.classList.add('speelt');
    kop.append(hoes, tekst);
    k.append(kop);
    const bediening = mediaBediening(x, laad);
    if (bediening) k.append(bediening);
    return k;
  }

  function maakIcoon() {
    const i = maak('span', 'media-icoon');
    i.innerHTML = BEELD.tv;
    return i;
  }

  function teken() {
    const aan = data.filter((x) => x.media.staat !== 'uit');
    const uit = data.filter((x) => x.media.staat === 'uit' && x.bereikbaar);
    blok.classList.toggle('leeg', data.length === 0);
    const delen: HTMLElement[] = aan.map(kaart);
    if (uit.length) {
      // Wat uit staat: een rij knopjes. Een tik klapt de bediening van dat apparaat open.
      const rij = maak('div', 'media-uit-rij');
      rij.append(maak('span', 'lbl', aan.length ? 'Ook' : 'Alles uit'));
      for (const x of uit) {
        const k = maak('button', 'chip media-chip', x.naam);
        k.type = 'button';
        k.setAttribute('aria-expanded', String(open === x.id));
        k.addEventListener('click', () => {
          open = open === x.id ? null : x.id;
          teken();
        });
        rij.append(k);
      }
      delen.push(rij);
      const gekozen = uit.find((x) => x.id === open);
      if (gekozen) delen.push(kaart(gekozen));
    }
    lijst.replaceChildren(...delen);
  }

  async function laad() {
    try {
      const antwoord = await fetch('/api/media');
      if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
      data = await antwoord.json();
    } catch {
      data = [];
    }
    // Niet opnieuw tekenen terwijl iemand schuift of een bron kiest.
    const kiest = lijst.contains(document.activeElement) && document.activeElement?.matches('select');
    if (!mediaBezig() && !schuiftNu() && !kiest) teken();
  }

  return { laad };
}
