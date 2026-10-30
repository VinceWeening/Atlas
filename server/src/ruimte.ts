// Hoeveel geheugen en schijfruimte de server vrij heeft, en welke lokale AI daarin past. In Docker ziet Atlas het geheugen
// en de schijf van de hele server, dus dit klopt ook voor de andere containers (Home Assistant, Frigate).
import { freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { map } from './opslag.js';

const GB = 1024 ** 3;
const gb = (n: number) => `${(n / GB).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} GB`;

// Wat elk model ongeveer nodig heeft als het geladen is, en op schijf. Ruim genomen, met een kleine context.
const MODELLEN = [
  { naam: 'qwen2.5:3b', geheugen: 2.6 * GB, schijf: 1.9 * GB },
  { naam: 'qwen2.5:1.5b', geheugen: 1.4 * GB, schijf: 1.0 * GB },
] as const;
const WHISPER = [
  { naam: 'Systran/faster-whisper-small', geheugen: 0.9 * GB, schijf: 0.5 * GB },
  { naam: 'Systran/faster-whisper-base', geheugen: 0.4 * GB, schijf: 0.15 * GB },
] as const;
// De programma's zelf (Ollama en Speaches) op schijf, en wat de server altijd vrij moet houden.
const PROGRAMMAS = 5 * GB;
const MARGE = 0.8 * GB;

export type Ruimte = {
  geheugen: { totaal: number; vrij: number };
  schijf: { totaal: number; vrij: number } | null;
  advies: { ai: string | null; whisper: string | null; tekst: string; past: boolean };
};

/** `inGebruik`: geheugen dat de AI nu al gebruikt (een geladen model), want dat komt vrij voor het model zelf. */
export async function ruimte(inGebruik = 0): Promise<Ruimte> {
  const geheugen = { totaal: totalmem(), vrij: freemem() };
  let schijf: Ruimte['schijf'] = null;
  try {
    const s = await statfs(map);
    schijf = { totaal: s.blocks * s.bsize, vrij: s.bavail * s.bsize };
  } catch {
    // Onbekend; dan alleen het geheugen.
  }
  const ruimGeheugen = geheugen.vrij + inGebruik - MARGE;
  const ruimSchijf = schijf ? schijf.vrij - PROGRAMMAS : Infinity;
  const whisper = WHISPER.find((w) => w.geheugen <= ruimGeheugen && w.schijf <= ruimSchijf) ?? null;
  const naWhisper = { geheugen: ruimGeheugen - (whisper?.geheugen ?? 0), schijf: ruimSchijf - (whisper?.schijf ?? 0) };
  const ai = MODELLEN.find((m) => m.geheugen <= naWhisper.geheugen && m.schijf <= naWhisper.schijf) ?? null;

  let tekst: string;
  if (ai && whisper) tekst = `Past: ${ai.naam} voor de AI en ${whisper.naam.split('-').at(-1)} voor spraak.`;
  else if (whisper) tekst = `Alleen spraak past (${whisper.naam.split('-').at(-1)}); voor de AI is te weinig geheugen vrij.`;
  else tekst = ruimSchijf < 0 ? 'Te weinig schijfruimte voor spraak en AI.' : 'Te weinig geheugen vrij voor spraak en AI.';
  if (ai?.naam === 'qwen2.5:1.5b') tekst += ' Het grotere qwen2.5:3b past net niet; 1.5b is wat minder slim maar sneller.';
  tekst += ` Vrij: ${gb(geheugen.vrij)} van ${gb(geheugen.totaal)} geheugen${schijf ? `, ${gb(schijf.vrij)} schijf` : ''}.`;
  return { geheugen, schijf, advies: { ai: ai?.naam ?? null, whisper: whisper?.naam ?? null, tekst, past: !!ai && !!whisper } };
}
