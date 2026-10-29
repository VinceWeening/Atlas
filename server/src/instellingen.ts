// Instellingen uit het tandwiel. Ze staan op de server, zodat pc en telefoon hetzelfde laten zien.
import { bewaar, lees } from './opslag.js';

export const BLOKKEN = ['huis', 'vandaag', 'belangrijk', 'mail', 'kamer', 'camera', 'scenes', 'hud'] as const;
type Blok = (typeof BLOKKEN)[number];
type Scherm = 'thuis' | 'overzicht';
export type Datum = { id: string; titel: string; datum: string; van: string | null };
export type Instellingen = {
  blokken: Record<Blok, boolean>;
  /** Startscherm voor een breed scherm (pc) en een smal scherm (telefoon). */
  start: { breed: Scherm; smal: Scherm };
  /** Belangrijke data: een deadline (alleen datum) of een periode (van t/m datum). */
  belangrijk: Datum[];
};

const standaard: Instellingen = {
  blokken: Object.fromEntries(BLOKKEN.map((b) => [b, true])) as Record<Blok, boolean>,
  start: { breed: 'thuis', smal: 'overzicht' },
  belangrijk: [],
};

let huidig = lees<Instellingen>('instellingen', standaard);
// Een blok dat later is toegevoegd, staat bij een oud bestand nog niet in de lijst.
huidig.blokken = { ...standaard.blokken, ...huidig.blokken };

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

  huidig = volgende;
  bewaar('instellingen', huidig);
  return null;
}
