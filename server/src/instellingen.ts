// Instellingen uit het tandwiel. Ze staan op de server, zodat pc en telefoon hetzelfde laten zien.
import { bewaar, lees } from './opslag.js';

export const BLOKKEN = ['huis', 'vandaag', 'belangrijk', 'mail', 'kamer', 'favorieten', 'camera', 'scenes', 'hud', 'frigate', 'jellyfin', 'seerr', 'downloads'] as const;
/** Blokken die standaard uit staan; de rest staat aan. */
const STANDAARD_UIT: readonly Blok[] = ['jellyfin', 'seerr', 'downloads'];
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
};
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
};

const standaard: Instellingen = {
  blokken: Object.fromEntries(BLOKKEN.map((b) => [b, !STANDAARD_UIT.includes(b)])) as Record<Blok, boolean>,
  start: { breed: 'thuis', smal: 'overzicht' },
  belangrijk: [],
  meldingen: { pc: true, telefoon: false, toestel: null, soorten: ['person'], camerasUit: [], wachttijd: 2, zones: [], bekenden: [] },
  favorieten: [],
  snelkoppelingen: [],
};

let huidig = lees<Instellingen>('instellingen', standaard);
// Een blok dat later is toegevoegd, staat bij een oud bestand nog niet in de lijst.
huidig.blokken = { ...standaard.blokken, ...huidig.blokken };
huidig.meldingen = { ...standaard.meldingen, ...huidig.meldingen };
huidig.favorieten ??= [];
huidig.snelkoppelingen ??= [];

export const instellingen = () => huidig;

const isDatum = (w: unknown): w is string => typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(w));
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
    if (m.wachttijd !== undefined) {
      if (typeof m.wachttijd !== 'number' || !Number.isInteger(m.wachttijd) || m.wachttijd < 0 || m.wachttijd > 60) return 'Ongeldige wachttijd';
      v.wachttijd = m.wachttijd;
    }
  }

  huidig = volgende;
  bewaar('instellingen', huidig);
  return null;
}
