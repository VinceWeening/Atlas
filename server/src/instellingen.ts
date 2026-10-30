// Instellingen uit het tandwiel. Ze staan op de server, zodat pc en telefoon hetzelfde laten zien.
import { bewaar, lees } from './opslag.js';

export const BLOKKEN = ['huis', 'vandaag', 'belangrijk', 'mail', 'kamer', 'favorieten', 'camera', 'scenes', 'hud', 'frigate', 'jellyfin', 'seerr', 'downloads', 'spraak', 'sneltoetsen', 'lucht', 'tijdlijn', 'energie', 'opdracht', 'afval', 'vertrek'] as const;
/** Blokken die standaard uit staan; de rest staat aan. */
// De spraakbol doet pas iets in fase 3, dus die staat tot dan uit.
const STANDAARD_UIT: readonly Blok[] = ['jellyfin', 'seerr', 'downloads', 'spraak'];
type Blok = (typeof BLOKKEN)[number];
type Scherm = 'thuis' | 'overzicht';
export type Datum = { id: string; titel: string; datum: string; van: string | null };
export const SOORTEN = ['person', 'car', 'bicycle', 'motorcycle', 'dog', 'cat', 'bird', 'package'] as const;
export type Meldingen = {
  pc: boolean;
  telefoon: boolean;
  /** notify-dienst van de Home Assistant-app, bijvoorbeeld mobile_app_iphone_vince. */
  toestel: string | null;
  /** Welke dingen die Frigate ziet een melding geven. */
  soorten: string[];
  /** Camera's die uit staan; een nieuwe camera doet dus vanzelf mee. */
  camerasUit: string[];
  /** Minuten stilte per camera na een melding. */
  wachttijd: number;
  /** Zones uit Frigate als "camera/zone". Heeft een camera gekozen zones, dan alleen een melding als iemand daarin komt. */
  zones: string[];
  /** Namen uit de gezichtsherkenning van Frigate die geen melding geven, bijvoorbeeld de mensen die hier wonen. */
  bekenden: string[];
  /** Stille uren: dan geen melding op pc of telefoon. Ze komen wel in de tijdlijn. */
  stil: Periode;
};
/** Een stuk van de dag, zoals 23:00 tot 07:00. Mag over middernacht gaan. */
export type Periode = { aan: boolean; van: string; tot: string };
export type Instellingen = {
  blokken: Record<Blok, boolean>;
  /** Startscherm voor een breed scherm (pc) en een smal scherm (telefoon). */
  start: { breed: Scherm; smal: Scherm };
  /** Belangrijke data: een deadline (alleen datum) of een periode (van t/m datum). */
  belangrijk: Datum[];
  meldingen: Meldingen;
  /** Lampen en schakelaars op de kaart Favorieten, in deze volgorde. */
  favorieten: string[];
  /** Knoppen onderin; leeg betekent alle scènes uit Home Assistant. */
  snelkoppelingen: string[];
  /** Eigen namen voor apparaten, op entiteit. Gaan voor de naam uit Home Assistant. */
  namen: Record<string, string>;
  /** Ochtendstand (agenda groot) en avondstand (rust) op Thuis en Overzicht. */
  standen: { ochtend: Periode; avond: Periode };
  /** Thuis en weg, via de personen in Home Assistant. Standaard uit. */
  weg: {
    aan: boolean;
    /** Een melding "Alles uit?" als iedereen weg is en er nog lampen branden. */
    allesUit: boolean;
    /** Camerameldingen op de telefoon alleen als iedereen weg is. */
    alleenWeg: boolean;
  };
  /** Vertrekhulp: reistijd naar plekken in je agenda. */
  vertrek: { reistijd: number; plekken: { naam: string; minuten: number }[] };
  /** Spraak en de lokale AI. Werkt alleen als OLLAMA_URL of WHISPER_URL is ingesteld. */
  assistent: {
    /** Vrije vragen ("wat moet ik vandaag nog doen?") beantwoorden met de lokale AI. */
    vragen: boolean;
    /** Antwoorden hardop uitspreken als je iets zei. */
    hardop: boolean;
  };
};

const standaard: Instellingen = {
  blokken: Object.fromEntries(BLOKKEN.map((b) => [b, !STANDAARD_UIT.includes(b)])) as Record<Blok, boolean>,
  start: { breed: 'thuis', smal: 'overzicht' },
  belangrijk: [],
  meldingen: {
    pc: true,
    telefoon: false,
    toestel: null,
    soorten: ['person'],
    camerasUit: [],
    wachttijd: 2,
    zones: [],
    bekenden: [],
    stil: { aan: false, van: '23:00', tot: '07:00' },
  },
  favorieten: [],
  snelkoppelingen: [],
  namen: {},
  standen: { ochtend: { aan: true, van: '06:00', tot: '10:00' }, avond: { aan: true, van: '21:00', tot: '01:00' } },
  weg: { aan: false, allesUit: true, alleenWeg: false },
  vertrek: { reistijd: 20, plekken: [] },
  assistent: { vragen: true, hardop: true },
};

let huidig = lees<Instellingen>('instellingen', standaard);
// Een blok dat later is toegevoegd, staat bij een oud bestand nog niet in de lijst.
huidig.blokken = { ...standaard.blokken, ...huidig.blokken };
huidig.meldingen = { ...standaard.meldingen, ...huidig.meldingen };
huidig.favorieten ??= [];
huidig.snelkoppelingen ??= [];
huidig.namen ??= {};
huidig.standen = { ...standaard.standen, ...huidig.standen };
huidig.weg = { ...standaard.weg, ...huidig.weg };
huidig.vertrek = { ...standaard.vertrek, ...huidig.vertrek };
huidig.assistent = { ...standaard.assistent, ...huidig.assistent };

export const instellingen = () => huidig;

const isDatum = (w: unknown): w is string => typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(w));
const isTijd = (w: unknown): w is string => typeof w === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(w);
const isPeriode = (w: unknown): w is Periode => {
  const p = w as Partial<Periode> | null;
  return !!p && typeof p === 'object' && typeof p.aan === 'boolean' && isTijd(p.van) && isTijd(p.tot);
};
/** Of het nu (in Nederlandse tijd) binnen een periode valt; een periode als 23:00-07:00 loopt over middernacht. */
export function nuIn(p: Periode, nu = new Date()) {
  if (!p.aan) return false;
  const [u, m] = nu.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).split(':').map(Number);
  const tijd = u * 60 + m;
  const [vu, vm] = p.van.split(':').map(Number);
  const [tu, tm] = p.tot.split(':').map(Number);
  const van = vu * 60 + vm;
  const tot = tu * 60 + tm;
  return van <= tot ? tijd >= van && tijd < tot : tijd >= van || tijd < tot;
}
const isScherm = (w: unknown): w is Scherm => w === 'thuis' || w === 'overzicht';

/** Controleert wat het scherm stuurt en neemt alleen bekende, geldige velden over. Geeft een foutmelding of null. */
export function zetInstellingen(nieuw: unknown): string | null {
  if (!nieuw || typeof nieuw !== 'object') return 'Ongeldige instellingen';
  const n = nieuw as Partial<Record<keyof Instellingen, unknown>>;
  const volgende: Instellingen = structuredClone(huidig);

  if (n.blokken !== undefined) {
    if (typeof n.blokken !== 'object' || n.blokken === null) return 'Ongeldige blokken';
    for (const [blok, aan] of Object.entries(n.blokken)) {
      if (!BLOKKEN.includes(blok as Blok) || typeof aan !== 'boolean') return `Onbekend blok: ${blok}`;
      volgende.blokken[blok as Blok] = aan;
    }
  }
  if (n.start !== undefined) {
    const s = n.start as Partial<Instellingen['start']>;
    if (!isScherm(s?.breed) || !isScherm(s?.smal)) return 'Ongeldig startscherm';
    volgende.start = { breed: s.breed, smal: s.smal };
  }
  if (n.belangrijk !== undefined) {
    if (!Array.isArray(n.belangrijk) || n.belangrijk.length > 20) return 'Ongeldige lijst met data';
    const lijst: Datum[] = [];
    for (const d of n.belangrijk as Partial<Datum>[]) {
      const titel = typeof d?.titel === 'string' ? d.titel.trim().slice(0, 80) : '';
      if (!titel || !isDatum(d.datum)) return 'Elke regel heeft een naam en een datum nodig';
      const van = d.van ? (isDatum(d.van) ? d.van : null) : null;
      if (d.van && !van) return `Ongeldige begindatum bij ${titel}`;
      if (van && van > d.datum) return `De begindatum van ${titel} ligt na de einddatum`;
      lijst.push({ id: typeof d.id === 'string' && d.id ? d.id.slice(0, 40) : crypto.randomUUID(), titel, datum: d.datum, van });
    }
    volgende.belangrijk = lijst.sort((a, b) => a.datum.localeCompare(b.datum));
  }
  for (const lijst of ['favorieten', 'snelkoppelingen'] as const) {
    const w = n[lijst];
    if (w === undefined) continue;
    if (!Array.isArray(w) || w.length > 30 || w.some((e) => typeof e !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(e))) return 'Ongeldige lijst met apparaten';
    volgende[lijst] = [...new Set(w as string[])];
  }
  if (n.namen !== undefined) {
    // Alleen de namen die meekomen veranderen; een lege naam haalt de eigen naam weg.
    if (!n.namen || typeof n.namen !== 'object' || Array.isArray(n.namen)) return 'Ongeldige namen';
    for (const [id, naam] of Object.entries(n.namen)) {
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(id) || typeof naam !== 'string' || naam.length > 60) return 'Ongeldige naam';
      if (naam.trim()) volgende.namen[id] = naam.trim();
      else delete volgende.namen[id];
    }
    if (Object.keys(volgende.namen).length > 500) return 'Te veel eigen namen';
  }
  if (n.standen !== undefined) {
    const st = n.standen as Partial<Instellingen['standen']> | null;
    if (!st || typeof st !== 'object') return 'Ongeldige standen';
    for (const stand of ['ochtend', 'avond'] as const) {
      if (st[stand] === undefined) continue;
      if (!isPeriode(st[stand])) return `Ongeldige ${stand}stand`;
      volgende.standen[stand] = { aan: st[stand]!.aan, van: st[stand]!.van, tot: st[stand]!.tot };
    }
  }
  if (n.weg !== undefined) {
    const w = n.weg as Partial<Instellingen['weg']> | null;
    if (!w || typeof w !== 'object') return 'Ongeldige instelling thuis en weg';
    for (const sleutel of ['aan', 'allesUit', 'alleenWeg'] as const) {
      if (w[sleutel] === undefined) continue;
      if (typeof w[sleutel] !== 'boolean') return 'Ongeldige instelling thuis en weg';
      volgende.weg[sleutel] = w[sleutel]!;
    }
  }
  if (n.assistent !== undefined) {
    const a = n.assistent as Partial<Instellingen['assistent']> | null;
    if (!a || typeof a !== 'object') return 'Ongeldige instelling spraak en AI';
    for (const sleutel of ['vragen', 'hardop'] as const) {
      if (a[sleutel] === undefined) continue;
      if (typeof a[sleutel] !== 'boolean') return 'Ongeldige instelling spraak en AI';
      volgende.assistent[sleutel] = a[sleutel]!;
    }
  }
  if (n.vertrek !== undefined) {
    const v = n.vertrek as Partial<Instellingen['vertrek']> | null;
    if (!v || typeof v !== 'object') return 'Ongeldige vertrekhulp';
    const minuten = (m: unknown) => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 300;
    if (v.reistijd !== undefined) {
      if (!minuten(v.reistijd)) return 'Reistijd is 0 tot 300 minuten';
      volgende.vertrek.reistijd = v.reistijd;
    }
    if (v.plekken !== undefined) {
      if (!Array.isArray(v.plekken) || v.plekken.length > 30) return 'Ongeldige plekken';
      const lijst: { naam: string; minuten: number }[] = [];
      for (const p of v.plekken as Partial<{ naam: string; minuten: number }>[]) {
        const naam = typeof p?.naam === 'string' ? p.naam.trim().slice(0, 60) : '';
        if (!naam || !minuten(p.minuten)) return 'Elke plek heeft een naam en 0 tot 300 minuten nodig';
        lijst.push({ naam, minuten: p.minuten! });
      }
      volgende.vertrek.plekken = lijst;
    }
  }
  if (n.meldingen !== undefined) {
    const m = n.meldingen as Partial<Meldingen>;
    if (!m || typeof m !== 'object') return 'Ongeldige meldingen';
    const v = volgende.meldingen;
    if (m.pc !== undefined) {
      if (typeof m.pc !== 'boolean') return 'Ongeldige meldingen';
      v.pc = m.pc;
    }
    if (m.telefoon !== undefined) {
      if (typeof m.telefoon !== 'boolean') return 'Ongeldige meldingen';
      v.telefoon = m.telefoon;
    }
    if (m.toestel !== undefined) {
      if (m.toestel !== null && (typeof m.toestel !== 'string' || !/^mobile_app_[a-z0-9_]+$/.test(m.toestel))) return 'Onbekende telefoon';
      v.toestel = m.toestel;
    }
    if (m.soorten !== undefined) {
      if (!Array.isArray(m.soorten) || m.soorten.some((s) => !(SOORTEN as readonly string[]).includes(s))) return 'Onbekende soort';
      v.soorten = [...new Set(m.soorten)];
    }
    if (m.camerasUit !== undefined) {
      if (!Array.isArray(m.camerasUit) || m.camerasUit.length > 50 || m.camerasUit.some((c) => typeof c !== 'string' || !/^[\w-]{1,64}$/.test(c)))
        return 'Ongeldige camera';
      v.camerasUit = [...new Set(m.camerasUit)];
    }
    if (m.zones !== undefined) {
      if (!Array.isArray(m.zones) || m.zones.length > 50 || m.zones.some((z) => typeof z !== 'string' || !/^[\w-]{1,64}\/[\w-]{1,64}$/.test(z)))
        return 'Ongeldige zone';
      v.zones = [...new Set(m.zones)];
    }
    if (m.bekenden !== undefined) {
      if (!Array.isArray(m.bekenden) || m.bekenden.length > 30 || m.bekenden.some((b) => typeof b !== 'string' || !b.trim() || b.length > 60))
        return 'Ongeldige naam';
      v.bekenden = [...new Set(m.bekenden.map((b) => b.trim()))];
    }
    if (m.stil !== undefined) {
      if (!isPeriode(m.stil)) return 'Ongeldige stille uren';
      v.stil = { aan: m.stil.aan, van: m.stil.van, tot: m.stil.tot };
    }
    if (m.wachttijd !== undefined) {
      if (typeof m.wachttijd !== 'number' || !Number.isInteger(m.wachttijd) || m.wachttijd < 0 || m.wachttijd > 60) return 'Ongeldige wachttijd';
      v.wachttijd = m.wachttijd;
    }
  }

  huidig = volgende;
  bewaar('instellingen', huidig);
  return null;
}
