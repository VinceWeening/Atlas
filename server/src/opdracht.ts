// Opdrachten in gewone taal, getypt in de opdrachtbalk of later uitgesproken: "woonkamer uit", "dim bureau naar 30%",
// "filmavond", "hoe warm is het boven". Geen AI: een vaste set zinnen die Atlas zeker goed begrijpt. Alleen lampen,
// schakelaars en scènes; sloten en camera's nooit.

import type { Energie } from './energie.js';
import type { Apparaat, Apparaten, Huis } from './ha.js';

export type Antwoord = {
  tekst: string;
  /** Of er iets in huis veranderd is. */
  gedaan: boolean;
  /** Een scherm om naartoe te gaan; dat doet de app zelf. */
  scherm?: 'thuis' | 'overzicht' | 'apparaten' | 'cameras';
  /** Als de lokale AI de zin herschreef: wat Atlas ervan maakte. */
  begrepen?: string;
  /** Of het antwoord van de lokale AI komt (een vrije vraag), zodat de app dat kan laten zien. */
  ai?: boolean;
};

export type Bron = {
  huis(): Promise<Huis>;
  apparaten(): Promise<Apparaten>;
  energie(): Promise<Energie>;
  lamp(id: string, opdracht: { aan?: boolean; helderheid?: number }): Promise<void>;
  bedien(id: string, aan: boolean): Promise<void>;
  scene(id: string): Promise<void>;
  /** Optioneel: lokale AI die een onbekende zin herschrijft naar een zin die Atlas kent. */
  hulp?: (zin: string, namen: { ruimtes: string[]; apparaten: string[]; scenes: string[] }) => Promise<string | null>;
  /** Optioneel: lokale AI die een vrije vraag beantwoordt met wat Atlas weet. Bedient zelf niets. */
  vraag?: (zin: string) => Promise<string | null>;
};

/** Kleine letters, zonder accenten en leestekens, zodat "Camera's" en "cameras" hetzelfde zijn. */
export const gewoon = (zin: string) =>
  zin
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

const woorden = (zin: string) => gewoon(zin).split(' ').filter(Boolean);
// Woorden die in een naam weinig zeggen; "Plafondlamp woonkamer" moet ook passen op "woonkamer".
const VULLING = new Set(['de', 'het', 'een', 'van', 'in', 'op', 'lamp', 'lampen', 'licht', 'lichten', 'spots', 'scene']);

/** Hoe goed een naam in de zin past: 0 is niet, hoger is beter. Alle betekenisvolle woorden van de naam moeten erin staan. */
function past(naam: string, zin: string[]) {
  const delen = woorden(naam).filter((w) => !VULLING.has(w));
  if (!delen.length) return 0;
  // Een woord mag ook een stukje meer of minder hebben: "slaapkamer" past op "slaapkamers", "cam" niet op "camera".
  const gevonden = delen.filter((d) => zin.some((w) => w === d || (d.length > 4 && (w.startsWith(d) || d.startsWith(w)) && w.length > 3)));
  // Helemaal passend wint altijd van half passend: "bureau" past half op de ruimte "Bureau Vince".
  if (gevonden.length === delen.length) return 100 + delen.length * 10 + delen.join('').length;
  return gevonden.length * 10 + gevonden.join('').length;
}

const SCHERMEN: [RegExp, NonNullable<Antwoord['scherm']>, string][] = [
  [/\bthuis\b|\bhuis\b/, 'thuis', 'Thuis'],
  [/overzicht/, 'overzicht', 'Overzicht'],
  [/apparaten/, 'apparaten', 'Apparaten'],
  [/camera/, 'cameras', "Camera's"],
];
const VOORBEELD = "Probeer 'woonkamer uit', 'dim bureau naar 30%' of 'filmavond'.";

const lijstje = (namen: string[]) => (namen.length <= 1 ? namen.join('') : `${namen.slice(0, -1).join(', ')} en ${namen.at(-1)}`);
const graden = (t: number) => `${t.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} graden`;

export async function voerUit(invoer: string, bron: Bron): Promise<Antwoord> {
  const zin = gewoon(invoer)
    .replace(/^(hey |he |hoi |ok )?atlas\b/, '')
    .replace(/\b(alsjeblieft|alstublieft|aub|graag|even|eens|maar|nou)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!zin) return { tekst: `Wat moet ik doen? ${VOORBEELD}`, gedaan: false };
  const z = zin.split(' ');
  const heeft = (re: RegExp) => re.test(zin);

  // Naar een scherm: "ga naar camera's", "open overzicht", of alleen "apparaten".
  const naar = heeft(/^(ga naar|naar|open|toon|laat( me)?( de)? zien|scherm)\b/) || SCHERMEN.some(([re]) => re.test(zin) && z.length <= 2);
  if (naar) {
    const scherm = SCHERMEN.find(([re]) => re.test(zin));
    if (scherm) return { tekst: scherm[2], gedaan: false, scherm: scherm[1] };
  }

  const huis = await bron.huis();
  const kamerIn = () => huis.kamers.map((k) => ({ k, score: past(k.naam, z) })).filter((x) => x.score).sort((a, b) => b.score - a.score)[0]?.k;

  // Vragen
  if (heeft(/\b(hoe (warm|koud)|temperatuur|graden|hoe heet)\b/)) {
    const kamer = kamerIn();
    if (kamer?.temperatuur != null) return { tekst: `In ${kamer.naam} is het ${graden(kamer.temperatuur)}.`, gedaan: false };
    const delen = [];
    if (huis.binnen != null) delen.push(`Binnen is het gemiddeld ${graden(huis.binnen)}`);
    if (huis.weer?.temperatuur != null) delen.push(`buiten ${graden(huis.weer.temperatuur)}`);
    return { tekst: delen.length ? `${delen.join(', ')}.` : 'Ik weet de temperatuur nu niet.', gedaan: false };
  }
  if (heeft(/\b(welke|hoeveel) (lampen|lichten)\b|\bwat staat (er )?aan\b|\bbranden er\b/)) {
    const aan = [...huis.kamers.flatMap((k) => k.lampen.filter((l) => l.aan).map((l) => l.naam)), ...huis.losseLampen.filter((l) => l.aan).map((l) => l.naam)];
    return { tekst: aan.length ? `Er ${aan.length === 1 ? 'is één lamp' : `zijn ${aan.length} lampen`} aan: ${lijstje(aan)}.` : 'Alle lampen zijn uit.', gedaan: false };
  }
  if (heeft(/\b(stroom|verbruik|energie|watt|gas)\b/) && heeft(/\b(hoeveel|wat|hoe)\b/)) {
    const e = await bron.energie();
    const delen = [];
    if (e.vermogen != null) delen.push(e.vermogen < 0 ? `Je levert nu ${-e.vermogen} watt terug` : `Het huis gebruikt nu ${e.vermogen} watt`);
    if (e.vandaag.stroom != null) delen.push(`vandaag ${e.vandaag.stroom.toLocaleString('nl-NL')} kWh`);
    if (e.vandaag.gas != null) delen.push(`${e.vandaag.gas.toLocaleString('nl-NL')} m³ gas`);
    return { tekst: delen.length ? `${delen.join(', ')}.` : 'Ik vind geen energiemeter in Home Assistant.', gedaan: false };
  }

  // Wat er moet gebeuren
  const procent = zin.match(/\b(\d{1,3}) ?(%|procent)/);
  let helderheid = procent ? Math.min(100, Math.max(1, Number(procent[1]))) : null;
  if (helderheid == null && heeft(/\b(dim|dimmen|zachter|donkerder)\b/)) helderheid = 30;
  if (helderheid == null && heeft(/\b(feller|helderder|vol|maximaal)\b/)) helderheid = 100;
  const uit = heeft(/\b(uit|off|uitzetten|uitdoen)\b/);
  const aan = !uit && (heeft(/\b(aan|on|aanzetten|aandoen|activeer|start)\b/) || helderheid != null);
  const welterusten = heeft(/\b(welterusten|slaap lekker|ik ga slapen|truste)\b/);

  // Scènes: "filmavond" of "start scène werken".
  const scene = huis.scenes.map((s) => ({ s, score: past(s.naam, z) })).filter((x) => x.score).sort((a, b) => b.score - a.score)[0]?.s
    ?? (welterusten ? huis.scenes.find((s) => /slap|nacht|welterusten/i.test(s.naam)) : undefined);
  if (scene && !uit) {
    await bron.scene(scene.id);
    return { tekst: `${welterusten ? 'Welterusten. ' : ''}${scene.naam} staat aan.`, gedaan: true };
  }

  const alleLampen = [...huis.kamers.flatMap((k) => k.lampen), ...huis.losseLampen];
  if (welterusten || heeft(/\b(alle (lampen|lichten)|alles|overal|heel het huis|het hele huis)\b/)) {
    if (!aan && !uit && !welterusten) return { tekst: 'Alle lampen aan of uit?', gedaan: false };
    const doel = welterusten || uit ? alleLampen.filter((l) => l.aan && l.bereikbaar) : alleLampen.filter((l) => !l.aan && l.bereikbaar);
    await Promise.all(doel.map((l) => bron.lamp(l.id, welterusten || uit ? { aan: false } : helderheid ? { helderheid } : { aan: true })));
    if (welterusten) return { tekst: doel.length ? `Welterusten. ${doel.length === 1 ? 'De laatste lamp is' : `${doel.length} lampen zijn`} uit.` : 'Welterusten. Alles was al uit.', gedaan: doel.length > 0 };
    return { tekst: doel.length ? `${doel.length === 1 ? 'Eén lamp' : `${doel.length} lampen`} ${uit ? 'uit' : 'aan'}.` : `Alle lampen waren al ${uit ? 'uit' : 'aan'}.`, gedaan: doel.length > 0 };
  }

  // Een apparaat of een ruimte. Het langst passende wint, zodat "bureau lamp" de lamp is en "bureau" de ruimte.
  const { ruimtes, overig } = await bron.apparaten();
  const bedienbaar = [...ruimtes.flatMap((r) => r.apparaten), ...overig].filter((a) => a.bediening === 'schakel' && a.bereikbaar);
  const apparaat = bedienbaar.map((a) => ({ a, score: past(a.naam, z) })).filter((x) => x.score).sort((a, b) => b.score - a.score)[0];
  const kamer = huis.kamers.map((k) => ({ k, score: past(k.naam, z) })).filter((x) => x.score && x.k.lampen.length).sort((a, b) => b.score - a.score)[0];

  // Lokale AI aan: laat het model een onduidelijke zin herschrijven, en probeer die één keer. Zelf bedient het model niets.
  // Is het eerder een vraag dan een opdracht, dan krijgt het model hem als vraag; met wat Atlas weet antwoordt het kort.
  const isVraag = /\?\s*$/.test(invoer) || /^(wat|wie|wanneer|waar|waarom|hoe|hoeveel|welke|welk|moet|heb|hebben|is|zijn|kan|kun|zal|wordt|komt|gaat|regent|vertel)\b/.test(zin);
  const metHulp = async (anders: Antwoord): Promise<Antwoord> => {
    if (!isVraag) {
      const nieuw = await bron.hulp?.(invoer, { ruimtes: huis.kamers.map((k) => k.naam), apparaten: bedienbaar.map((a) => a.naam), scenes: huis.scenes.map((s) => s.naam) });
      if (nieuw && gewoon(nieuw) !== gewoon(invoer)) {
        const tweede = await voerUit(nieuw, { ...bron, hulp: undefined, vraag: undefined });
        if (!tweede.tekst.startsWith('Dat snap ik nog niet')) return { ...tweede, begrepen: nieuw };
      }
    }
    if (!bron.vraag || (!isVraag && !anders.tekst.startsWith('Dat snap ik nog niet'))) return anders;
    const antwoord = await bron.vraag(invoer.trim());
    return antwoord ? { tekst: antwoord, gedaan: false, ai: true } : anders;
  };
  if (!apparaat && !kamer) return metHulp({ tekst: `Dat snap ik nog niet. ${VOORBEELD}`, gedaan: false });
  if (!aan && !uit) return metHulp({ tekst: `${(apparaat && (!kamer || apparaat.score > kamer.score) ? apparaat.a.naam : kamer!.k.naam)}: aan of uit?`, gedaan: false });

  if (apparaat && (!kamer || apparaat.score > kamer.score)) {
    const a: Apparaat = apparaat.a;
    if (a.soort === 'light' && helderheid != null && a.lamp?.dimbaar) {
      await bron.lamp(a.id, { helderheid });
      return { tekst: `${a.naam} op ${helderheid}%.`, gedaan: true };
    }
    if (a.soort === 'light') await bron.lamp(a.id, { aan: !uit });
    else await bron.bedien(a.id, !uit);
    return { tekst: `${a.naam} ${uit ? 'uit' : 'aan'}.`, gedaan: true };
  }

  const k = kamer!.k;
  const lampen = k.lampen.filter((l) => l.bereikbaar);
  await Promise.all(lampen.map((l) => bron.lamp(l.id, uit ? { aan: false } : helderheid != null && l.dimbaar ? { helderheid } : { aan: true })));
  const wat = lampen.length === 1 ? 'lamp' : `${lampen.length} lampen`;
  return { tekst: `${k.naam}: ${wat} ${uit ? 'uit' : helderheid != null ? `op ${helderheid}%` : 'aan'}.`, gedaan: lampen.length > 0 };
}
