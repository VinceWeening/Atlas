// Lokale AI (Ollama), standaard uit. Atlas gebruikt hem alleen als hulp: als de opdrachtbalk een zin niet snapt, mag het
// model hem herschrijven naar een zin die Atlas wel kent. Het model bedient zelf niets; dat blijft de vaste set zinnen in
// opdracht.ts. Zet OLLAMA_URL (bijvoorbeeld http://host.docker.internal:11434) en eventueel OLLAMA_MODEL.

const adres = process.env.OLLAMA_URL?.trim().replace(/\/+$/, '') || null;
const model = process.env.OLLAMA_MODEL?.trim() || 'qwen2.5:3b';

export const aiAan = () => !!adres;

export async function aiBereikbaar() {
  if (!adres) return null;
  try {
    return (await fetch(`${adres}/api/tags`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
}

/** Herschrijft een vrije zin naar een opdracht die Atlas kent, of null als het model het ook niet weet. */
export async function herschrijf(zin: string, namen: { ruimtes: string[]; apparaten: string[]; scenes: string[] }) {
  if (!adres) return null;
  const uitleg = [
    'Je zet een Nederlandse zin om naar precies één opdracht voor een slim huis. Antwoord alleen met de opdracht, zonder uitleg.',
    'Toegestane vormen:',
    '- "<ruimte of apparaat> aan" of "<ruimte of apparaat> uit"',
    '- "dim <ruimte of apparaat> naar <getal>%"',
    '- "alle lampen aan" of "alle lampen uit"',
    '- "<scène>"',
    '- "hoe warm is het in <ruimte>", "welke lampen zijn aan", "hoeveel stroom gebruiken we"',
    '- "ga naar thuis", "ga naar overzicht", "ga naar apparaten", "ga naar cameras"',
    `Ruimtes: ${namen.ruimtes.join(', ') || 'geen'}.`,
    `Apparaten: ${namen.apparaten.slice(0, 80).join(', ') || 'geen'}.`,
    `Scènes: ${namen.scenes.join(', ') || 'geen'}.`,
    'Past de zin nergens bij, antwoord dan alleen: ONBEKEND',
  ].join('\n');
  try {
    const antwoord = await fetch(`${adres}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, options: { temperature: 0 }, messages: [{ role: 'system', content: uitleg }, { role: 'user', content: zin }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!antwoord.ok) return null;
    const tekst = ((await antwoord.json()) as { message?: { content?: string } }).message?.content?.trim().replace(/^["'`]+|["'`.]+$/g, '') ?? '';
    return !tekst || /onbekend/i.test(tekst) || tekst.length > 120 ? null : tekst;
  } catch {
    return null;
  }
}
