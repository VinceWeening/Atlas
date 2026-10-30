// Vertrekhulp: hoe laat je weg moet voor je volgende afspraak, en of het dan regent. De reistijd komt uit het tandwiel
// (een vaste tijd, of per plek zoals "Xafax = 25"); de regen uit de neerslagverwachting van Buienradar voor Heiloo.
import type { Afspraak } from './google.js';
import { instellingen } from './instellingen.js';

export type Vertrek = { titel: string; plek: string | null; begin: string; om: string; reistijd: number };
export type Regen = { tekst: string; nu: boolean; komt: boolean };


/** De eerstvolgende afspraak van vandaag waar je heen moet: met een plek, of met een naam uit je lijst met plekken. */
export function volgendeVertrek(afspraken: Afspraak[], nu = new Date()): Vertrek | null {
  const { reistijd, plekken } = instellingen().vertrek;
  for (const a of afspraken) {
    if (!a.begin || new Date(a.begin) <= nu) continue;
    const tekst = `${a.titel} ${a.plek ?? ''}`.toLowerCase();
    const plek = plekken.find((p) => tekst.includes(p.naam.toLowerCase()));
    if (!plek && !a.plek) continue;
    const minuten = plek?.minuten ?? reistijd;
    const om = new Date(new Date(a.begin).getTime() - minuten * 60_000);
    // Al ruim te laat om te vertrekken: dan ben je er waarschijnlijk al, of je gaat niet.
    if (om.getTime() < nu.getTime() - 15 * 60_000) continue;
    return { titel: a.titel, plek: plek?.naam ?? a.plek?.split(',')[0] ?? null, begin: a.begin, om: om.toISOString(), reistijd: minuten };
  }
  return null;
}

let regenCache: { tijd: number; waarde: Regen | null } | null = null;
const LAT = process.env.ATLAS_LAT ?? '52.60';
const LON = process.env.ATLAS_LON ?? '4.70';

/**
 * Buienradar geeft per vijf minuten een waarde van 0 tot 255 voor de komende twee uur. Vanaf 77 (ongeveer 0,1 mm per
 * uur) noemen we het regen. Lukt het ophalen niet, dan geen regenregel.
 */
export async function regen(): Promise<Regen | null> {
  if (regenCache && Date.now() - regenCache.tijd < 5 * 60_000) return regenCache.waarde;
  let waarde: Regen | null = null;
  try {
    const antwoord = await fetch(`https://gpsgadget.buienradar.nl/data/raintext?lat=${LAT}&lon=${LON}`, { signal: AbortSignal.timeout(6000) });
    if (antwoord.ok) waarde = leesRegen(await antwoord.text());
  } catch {
    waarde = null;
  }
  regenCache = { tijd: Date.now(), waarde };
  return waarde;
}

export function leesRegen(tekst: string): Regen | null {
  const regels = tekst
    .trim()
    .split(/\r?\n/)
    .map((r) => r.split('|'))
    .filter((r) => r.length === 2 && /^\d+$/.test(r[0].trim()) && /^\d{2}:\d{2}$/.test(r[1].trim()))
    .map(([w, t]) => ({ nat: Number(w) >= 77, tijd: t.trim() }));
  if (!regels.length) return null;
  const nuNat = regels[0].nat;
  const wissel = regels.find((r) => r.nat !== nuNat);
  const einde = regels.at(-1)!.tijd;
  if (nuNat) return { tekst: wissel ? `Regen, droog vanaf ${wissel.tijd}` : `Regen tot na ${einde}`, nu: true, komt: true };
  return wissel ? { tekst: `Regen vanaf ${wissel.tijd}`, nu: false, komt: true } : { tekst: `Droog tot ${einde}`, nu: false, komt: false };
}

