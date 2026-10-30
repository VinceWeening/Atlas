// Lokale AI (Ollama), standaard uit. Atlas gebruikt hem op twee manieren:
// 1. als hulp: snapt de opdrachtbalk een zin niet, dan herschrijft het model hem naar een zin die Atlas wel kent. Het model
//    bedient zelf niets; dat blijft de vaste set zinnen in opdracht.ts.
// 2. voor vrije vragen ("wat staat er vandaag nog?"): het model krijgt een kort overzicht van agenda, weer, huis en energie
//    en antwoordt in een of twee zinnen. Ook dan bedient het niets.
// Zet OLLAMA_URL (bijvoorbeeld http://host.docker.internal:11434) en eventueel OLLAMA_MODEL. Ontbreekt het model nog, dan
// haalt Atlas het zelf op.

const adres = process.env.OLLAMA_URL?.trim().replace(/\/+$/, '') || null;
export const aiModel = process.env.OLLAMA_MODEL?.trim() || 'qwen2.5:3b';

export const aiAan = () => !!adres;

/** Waar het ophalen van het model staat; voor het controlescherm. */
let ophalen: { staat: 'klaar' | 'bezig' | 'mislukt' | 'onbekend'; sinds: number } = { staat: 'onbekend', sinds: Date.now() };
export const aiModelStaat = () => ophalen.staat;

export async function aiBereikbaar() {
  if (!adres) return null;
  try {
    return (await fetch(`${adres}/api/tags`, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
}

/** Haalt het model op als Ollama het nog niet heeft. Draait op de achtergrond; een paar GB kan even duren. */
export async function zorgVoorModel(log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (!adres || ophalen.staat === 'bezig') return;
  try {
    const lijst = (await (await fetch(`${adres}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()) as { models?: { name: string }[] };
    const naam = aiModel.includes(':') ? aiModel : `${aiModel}:latest`;
    if (lijst.models?.some((m) => m.name === naam)) {
      ophalen = { staat: 'klaar', sinds: Date.now() };
      return;
    }
    ophalen = { staat: 'bezig', sinds: Date.now() };
    log.info(`Lokale AI: model ${aiModel} ophalen`);
    const antwoord = await fetch(`${adres}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: aiModel, stream: false }),
      signal: AbortSignal.timeout(60 * 60_000),
    });
    ophalen = { staat: antwoord.ok ? 'klaar' : 'mislukt', sinds: Date.now() };
    log.info(`Lokale AI: model ${aiModel} ${antwoord.ok ? 'staat klaar' : `niet opgehaald (${antwoord.status})`}`);
  } catch {
    // Ollama draait (nog) niet; bij de volgende poging opnieuw.
    if (ophalen.staat === 'bezig') ophalen = { staat: 'mislukt', sinds: Date.now() };
    log.warn('Lokale AI: Ollama niet bereikbaar, model niet gecontroleerd');
  }
}

async function chat(berichten: { role: 'system' | 'user'; content: string }[], opties: { temperatuur: number; max: number; wacht: number }) {
  if (!adres) return null;
  try {
    const antwoord = await fetch(`${adres}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiModel,
        stream: false,
        // Na tien minuten zonder vragen geeft Ollama het geheugen weer vrij.
        keep_alive: '10m',
        options: { temperature: opties.temperatuur, num_predict: opties.max, num_ctx: 2048 },
        messages: berichten,
      }),
      signal: AbortSignal.timeout(opties.wacht),
    });
    if (!antwoord.ok) return null;
    return ((await antwoord.json()) as { message?: { content?: string } }).message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Herschrijft een vrije zin naar een opdracht die Atlas kent, of null als het model het ook niet weet. */
export async function herschrijf(zin: string, namen: { ruimtes: string[]; apparaten: string[]; scenes: string[] }) {
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
    'Is de zin een vraag of past hij nergens bij, antwoord dan alleen: ONBEKEND',
  ].join('\n');
  const tekst = (await chat([{ role: 'system', content: uitleg }, { role: 'user', content: zin }], { temperatuur: 0, max: 40, wacht: 20_000 }))?.replace(/^["'`]+|["'`.]+$/g, '') ?? '';
  return !tekst || /onbekend/i.test(tekst) || tekst.length > 120 ? null : tekst;
}

/** Beantwoordt een vrije vraag met wat Atlas weet. Kort, want het antwoord wordt vaak hardop uitgesproken. */
export async function beantwoord(vraag: string, weet: string) {
  const uitleg = [
    'Je bent Atlas, de huisassistent van dit huis. Je antwoordt in het Nederlands, vriendelijk en kort: hooguit twee zinnen, zonder opsommingen of opmaak, want het antwoord wordt hardop uitgesproken.',
    'Gebruik alleen de gegevens hieronder en algemene kennis. Weet je iets niet zeker, zeg dat dan eerlijk. Verzin geen afspraken, mails of apparaten.',
    'Je kunt zelf niets in huis bedienen. Vraagt iemand dat, zeg dan welke opdracht er kan, zoals "woonkamer uit".',
    '',
    weet,
  ].join('\n');
  const tekst = await chat([{ role: 'system', content: uitleg }, { role: 'user', content: vraag }], { temperatuur: 0.3, max: 120, wacht: 60_000 });
  return tekst ? tekst.replace(/[*#_`]/g, '').replace(/\s+/g, ' ').trim() : null;
}

/** Hoeveel geheugen de geladen modellen in Ollama nu gebruiken, in bytes; telt mee als ruimte voor de AI. */
export async function aiGeladen() {
  if (!adres) return 0;
  try {
    const d = (await (await fetch(`${adres}/api/ps`, { signal: AbortSignal.timeout(3000) })).json()) as { models?: { size?: number }[] };
    return (d.models ?? []).reduce((n, m) => n + (m.size ?? 0), 0);
  } catch {
    return 0;
  }
}
