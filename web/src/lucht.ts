// De lucht achter Atlas zoals hij buiten is: licht overdag, schemer bij zonsop- en ondergang, donker 's nachts, met de
// zon of de maan op hun echte plek boven Heiloo. De sterrenkunde komt uit SunCalc (Vladimir Agafonkin, BSD-licentie),
// ingekort tot wat hier nodig is.

const HEILOO = { breedte: 52.6, lengte: 4.7 };
const rad = Math.PI / 180;
const e = rad * 23.4397;

const dagen = (d: Date) => d.getTime() / 86_400_000 - 0.5 + 2440588 - 2451545;
const rechteKlimming = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const declinatie = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const sterrentijd = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw;

function plek(d: number, ra: number, dec: number) {
  const lw = rad * -HEILOO.lengte;
  const phi = rad * HEILOO.breedte;
  const H = sterrentijd(d, lw) - ra;
  return {
    hoogte: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad,
    // Kompasrichting: 90 is oost, 180 zuid, 270 west.
    richting: (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / rad + 180 + 360) % 360,
  };
}

export function zon(nu = new Date()) {
  const d = dagen(nu);
  const M = rad * (357.5291 + 0.98560028 * d);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  return plek(d, rechteKlimming(L, 0), declinatie(L, 0));
}

export function maan(nu = new Date()) {
  const d = dagen(nu);
  const L = rad * (218.316 + 13.176396 * d);
  const M = rad * (134.963 + 13.064993 * d);
  const F = rad * (93.272 + 13.22935 * d);
  const l = L + rad * 6.289 * Math.sin(M);
  const b = rad * 5.128 * Math.sin(F);
  // Fase: 0 nieuwe maan, 0,5 volle maan. Gerekend vanaf een bekende nieuwe maan (6 januari 2000).
  const fase = ((((nu.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000) % 29.530588853) + 29.530588853) % 29.530588853 / 29.530588853;
  return { ...plek(d, rechteKlimming(l, b), declinatie(l, b)), fase };
}

/** SVG-pad van het verlichte deel van de maan, voor een cirkel met straal r rond (r, r). */
function maanPad(fase: number, r: number) {
  const wassend = fase < 0.5;
  const sikkel = fase < 0.25 || fase > 0.75;
  const rx = Math.abs(Math.cos(2 * Math.PI * fase)) * r;
  const buiten = wassend ? 1 : 0;
  const binnen = wassend ? (sikkel ? 0 : 1) : sikkel ? 1 : 0;
  return `M${r} 0 A${r} ${r} 0 0 ${buiten} ${r} ${2 * r} A${rx.toFixed(2)} ${r} 0 0 ${binnen} ${r} 0Z`;
}

type Kleur = [number, number, number];
const meng = (a: Kleur, b: Kleur, t: number): Kleur => a.map((x, i) => Math.round(x + (b[i] - x) * t)) as Kleur;
const css = (k: Kleur) => `rgb(${k.join(' ')})`;
const tussen = (x: number, van: number, tot: number) => Math.min(1, Math.max(0, (x - van) / (tot - van)));

// Luchtkleuren boven en aan de horizon, van nacht via schemer naar dag. Overdag bewust gedempt, zodat het glas en de
// witte letters erop goed leesbaar blijven.
const NACHT: [Kleur, Kleur] = [[7, 9, 13], [14, 20, 34]];
const SCHEMER: [Kleur, Kleur] = [[22, 28, 58], [150, 92, 82]];
const GOUD: [Kleur, Kleur] = [[60, 84, 128], [214, 150, 96]];
const DAG: [Kleur, Kleur] = [[78, 112, 156], [150, 176, 198]];

export function tekenLucht(app: HTMLElement, aan: boolean, nu = new Date()) {
  const vak = document.getElementById('lucht');
  if (!vak) return;
  app.toggleAttribute('data-lucht', aan);
  if (!aan) {
    app.removeAttribute('data-licht');
    return;
  }
  const z = zon(nu);
  const m = maan(nu);
  // Hoogte van de zon bepaalt de kleur: onder -12° nacht, tot 0° schemer, tot 10° gouden uur, daarboven dag.
  const h = z.hoogte;
  const [boven, onder] =
    h < -12 ? NACHT
    : h < 0 ? [meng(NACHT[0], SCHEMER[0], tussen(h, -12, 0)), meng(NACHT[1], SCHEMER[1], tussen(h, -12, 0))]
    : h < 10 ? [meng(SCHEMER[0], GOUD[0], tussen(h, 0, 5)), meng(SCHEMER[1], GOUD[1], tussen(h, 0, 5))].map((k, i) => meng(k, DAG[i], tussen(h, 5, 10))) as [Kleur, Kleur]
    : DAG;
  app.style.setProperty('--lucht-boven', css(boven));
  app.style.setProperty('--lucht-onder', css(onder));
  app.setAttribute('data-licht', h >= 5 ? 'dag' : h >= -6 ? 'schemer' : 'nacht');

  // Zon of maan: links is oost, rechts is west. Hoe hoger aan de hemel, hoe hoger in beeld.
  const lichaam = z.hoogte > -2 ? { soort: 'zon', ...z } : m.hoogte > -2 ? { soort: 'maan', ...m } : null;
  if (!lichaam) {
    vak.replaceChildren();
    return;
  }
  const x = 6 + tussen(lichaam.richting, 60, 300) * 88;
  // De horizon ligt op een derde van het scherm, zodat zon en maan boven het huis staan en niet erachter verdwijnen.
  const y = 34 - tussen(lichaam.hoogte, -2, 50) * 27;
  const bol = document.createElement('div');
  bol.className = `hemel ${lichaam.soort}`;
  bol.style.left = `${x}%`;
  bol.style.top = `${y}%`;
  bol.setAttribute('aria-hidden', 'true');
  if (lichaam.soort === 'maan') {
    const r = 22;
    bol.innerHTML = `<svg width="${2 * r}" height="${2 * r}" viewBox="0 0 ${2 * r} ${2 * r}"><circle cx="${r}" cy="${r}" r="${r}" fill="rgba(214,226,240,0.10)"/><path d="${maanPad(m.fase, r)}" fill="#E8EEF6"/></svg>`;
  }
  vak.replaceChildren(bol);
}
