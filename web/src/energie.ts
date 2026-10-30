// Blok Energie en klimaat op Overzicht: wat het huis nu gebruikt, het verbruik van vandaag, de thermostaat en per ruimte
// de temperatuur en luchtvochtigheid. Het blok verdwijnt vanzelf als Home Assistant geen meters of sensoren heeft.

export type Energie = {
  bron: 'home-assistant' | 'voorbeeld';
  vermogen: number | null;
  vandaag: { stroom: number | null; terug: number | null; gas: number | null; opwek: number | null };
  thermostaat: { id: string; naam: string; huidig: number | null; doel: number | null; stand: string } | null;
  kamers: { id: string; naam: string; temperatuur: number | null; vocht: number | null }[];
};

const $ = (id: string) => document.getElementById(id)!;
const getal = (n: number, cijfers = 1) => n.toLocaleString('nl-NL', { minimumFractionDigits: cijfers, maximumFractionDigits: cijfers });
const graad = (n: number) => `${getal(n)}°`;

function el(tag: string, klasse: string, inhoud?: string) {
  const e = document.createElement(tag);
  e.className = klasse;
  if (inhoud !== undefined) e.textContent = inhoud;
  return e;
}

export function tekenEnergie(e: Energie | null) {
  const blok = $('energie-blok');
  const nu = $('energie-nu');
  const vandaag = $('energie-vandaag');
  const thermostaat = $('thermostaat');
  const klimaat = $('klimaat');
  if (!e) return;

  // Nu: groot getal, met teruglevering in ijsblauw omdat dat "goed" is, zonder er een alarmkleur van te maken.
  nu.replaceChildren();
  if (e.vermogen != null) {
    const terug = e.vermogen < 0;
    const w = Math.abs(e.vermogen);
    const waarde = el('span', 'energie-getal', w >= 1000 ? getal(w / 1000, 2) : String(w));
    const eenheid = el('span', 'energie-eenheid', w >= 1000 ? 'kW' : 'W');
    const uitleg = el('span', 'muted klein', terug ? 'terug naar het net' : 'nu van het net');
    nu.classList.toggle('terug', terug);
    nu.append(waarde, eenheid, uitleg);
  }
  nu.hidden = e.vermogen == null;

  const stats: [string, number | null, string][] = [
    ['Stroom', e.vandaag.stroom, 'kWh'],
    ['Terug', e.vandaag.terug, 'kWh'],
    ['Zon', e.vandaag.opwek, 'kWh'],
    ['Gas', e.vandaag.gas, 'm³'],
  ];
  vandaag.replaceChildren(
    ...stats
      .filter(([, w]) => w != null)
      .map(([naam, w, eenheid]) => {
        const vak = el('div', 'energie-stat');
        vak.append(el('dt', 'lbl', naam), el('dd', 'mono', `${getal(w!)} ${eenheid}`));
        return vak;
      }),
  );
  vandaag.hidden = !vandaag.childElementCount;
  vandaag.style.setProperty('--n', String(vandaag.childElementCount || 1));
  if (!vandaag.hidden) vandaag.setAttribute('aria-label', 'Vandaag');

  thermostaat.hidden = !e.thermostaat;
  if (e.thermostaat) {
    const t = e.thermostaat;
    const links = el('div', 'thermostaat-tekst');
    links.append(el('strong', '', t.naam), el('span', 'muted klein', t.stand));
    const rechts = el('span', 'mono thermostaat-graden');
    rechts.textContent = [t.huidig != null ? graad(t.huidig) : null, t.doel != null && t.doel !== t.huidig ? `→ ${graad(t.doel)}` : null].filter(Boolean).join(' ');
    thermostaat.classList.toggle('warm', /verwarm/i.test(t.stand));
    thermostaat.replaceChildren(links, rechts);
  }

  klimaat.replaceChildren(
    ...e.kamers.map((k) => {
      const rij = el('li', 'klimaat-rij');
      rij.append(el('span', 'klimaat-naam', k.naam));
      rij.append(el('span', 'mono', k.temperatuur != null ? graad(k.temperatuur) : ''));
      // Vocht boven 70% krijgt een stip: dan is ventileren slim (schimmel). Verder geen kleuren.
      if (k.vocht != null) {
        const v = el('span', `mono muted${k.vocht >= 70 ? ' vochtig' : ''}`, `${Math.round(k.vocht)}%`);
        v.title = k.vocht >= 70 ? 'Vochtig: even luchten' : 'Luchtvochtigheid';
        rij.append(v);
      } else rij.append(el('span', ''));
      return rij;
    }),
  );
  klimaat.hidden = !e.kamers.length;

  $('energie-bron').textContent = e.bron === 'voorbeeld' ? 'voorbeeld' : '';
  blok.classList.toggle('leeg', nu.hidden && vandaag.hidden && thermostaat.hidden && klimaat.hidden);
}

export async function laadEnergie() {
  try {
    const a = await fetch('/api/energie');
    if (!a.ok) return;
    tekenEnergie((await a.json()) as Energie);
  } catch {
    // Server even weg: het blok laat de laatste waarden staan.
  }
}
