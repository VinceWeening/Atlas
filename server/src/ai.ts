// AI voor de opdrachtbalk, standaard uit. Twee soorten, allebei optioneel:
// - Lokale AI (Ollama): blijft thuis, maar een klein model weet weinig. Zet OLLAMA_URL (bijvoorbeeld
//   http://host.docker.internal:11434) en eventueel OLLAMA_MODEL. Ontbreekt het model nog, dan haalt Atlas het zelf op.
// - Claude (via internet): kan echt allerlei vragen beantwoorden en zoekt zelf op internet naar actuele dingen (nieuws,
//   sport, openingstijden). Zet ANTHROPIC_API_KEY en eventueel ANTHROPIC_MODEL. Kost een paar cent per vraag, en wat
//   Atlas weet (agenda, mailonderwerpen, huis) gaat dan mee naar Anthropic. Uit te zetten in het tandwiel.
// Staan ze allebei aan, dan gebruikt Atlas Claude, en de lokale AI als Claude niet bereikbaar is.
// Atlas gebruikt de AI op twee manieren:
// 1. als hulp: snapt de opdrachtbalk een zin niet, dan herschrijft het model hem naar een zin die Atlas wel kent. Het model
//    bedient zelf niets; dat blijft de vaste set zinnen in opdracht.ts.
// 2. voor vrije vragen ("wat staat er vandaag nog?", "hoe lang moet een ei koken?"): het model krijgt een kort overzicht
//    van agenda, weer, huis en energie, en de vorige vragen van dit gesprek. Ook dan bedient het niets.

import Anthropic from '@anthropic-ai/sdk';

const claudeSleutel = process.env.ANTHROPIC_API_KEY?.trim() || null;
export const claudeModel = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5';
const claude = claudeSleutel ? new Anthropic({ apiKey: claudeSleutel, maxRetries: 1 }) : null;
export const claudeIngesteld = () => !!claude;

const adres = process.env.OLLAMA_URL?.trim().replace(/\/+$/, '') || null;
export const aiModel = process.env.OLLAMA_MODEL?.trim() || 'qwen2.5:3b';

export const ollamaAan = () => !!adres;

/** Welke AI er nu antwoordt; de tandwielschakelaar 'cloud' kan Claude uitzetten. */
export const aiAan = (cloud = true) => !!adres || (cloud && !!claude);

/** Of Claude bereikbaar is met deze sleutel; voor het controlescherm. null = geen sleutel. */
export async function claudeBereikbaar() {
  if (!claude) return null;
  try {
    await claude.models.retrieve(claudeModel, {}, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Waar het ophalen van het model staat; voor het controlescherm. */
let ophalen: { staat: 'klaar' | 'bezig' | 'mislukt' | 'onbekend'; sinds: number } = { staat: 'onbekend', sinds: Date.now() };
export const aiModelStaat = () => ophalen.staat;

export async function ollamaBereikbaar() {
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

type Bericht = { role: 'user' | 'assistant'; content: string };
/** Eén eerdere vraag en het antwoord, zodat je kunt doorvragen ("en morgen?"). */
export type Beurt = { vraag: string; antwoord: string };
export type AiAntwoord = { tekst: string; bron: 'claude' | 'lokaal'; bronnen?: { titel: string; url: string }[] };

// Nieuwere Opus- en Sonnet-modellen kennen de slimmere zoekvariant; de rest de gewone.
const zoekTool = (model: string) => (/opus-(4-[6-9]|5)|sonnet-(4-6|5)/.test(model) ? 'web_search_20260209' : 'web_search_20250305');
// Weigert het model een vraag, dan probeert de server een ander model. Alleen voor modellen die dat kennen.
const metTerugval = (model: string) => /opus-5|sonnet-5-5|fable-5-1/.test(model);

async function vraagClaude(systeem: string, berichten: Bericht[], opties: { max: number; wacht: number; zoeken: boolean }): Promise<Omit<AiAntwoord, 'bron'> | null> {
  if (!claude) return null;
  try {
    const antwoord = await claude.beta.messages.create(
      {
        model: claudeModel,
        max_tokens: opties.max,
        system: systeem,
        messages: berichten,
        // Snel en zuinig: de meeste vragen zijn kort.
        output_config: { effort: 'low' },
        ...(opties.zoeken
          ? { tools: [{ type: zoekTool(claudeModel), name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'Heiloo', country: 'NL', timezone: 'Europe/Amsterdam' } } as Anthropic.Beta.BetaToolUnion] }
          : {}),
        ...(metTerugval(claudeModel) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { timeout: opties.wacht },
    );
    if (antwoord.stop_reason === 'refusal') return null;
    const tekst = antwoord.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    // Waar het antwoord vandaan komt als Claude zocht: de eerste drie gevonden pagina's.
    const bronnen = antwoord.content
      .flatMap((b) => (b.type === 'web_search_tool_result' && Array.isArray(b.content) ? b.content : []))
      .map((r) => ({ titel: r.title, url: r.url }))
      .filter((r, i, alle) => alle.findIndex((x) => x.url === r.url) === i)
      .slice(0, 3);
    return tekst ? { tekst, ...(bronnen.length ? { bronnen } : {}) } : null;
  } catch {
    return null;
  }
}

async function chat(berichten: { role: 'system' | 'user' | 'assistant'; content: string }[], opties: { temperatuur: number; max: number; wacht: number }) {
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
        options: { temperature: opties.temperatuur, num_predict: opties.max, num_ctx: 4096 },
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
export async function herschrijf(zin: string, namen: { ruimtes: string[]; apparaten: string[]; scenes: string[] }, cloud = true) {
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
  const ruw =
    (cloud ? (await vraagClaude(uitleg, [{ role: 'user', content: zin }], { max: 200, wacht: 15_000, zoeken: false }))?.tekst : null) ??
    (await chat([{ role: 'system', content: uitleg }, { role: 'user', content: zin }], { temperatuur: 0, max: 40, wacht: 20_000 }));
  const tekst = ruw?.replace(/^["'`]+|["'`.]+$/g, '') ?? '';
  return !tekst || /onbekend/i.test(tekst) || tekst.length > 120 ? null : tekst;
}

/**
 * Beantwoordt een vrije vraag met wat Atlas weet, en met algemene kennis. Gesproken: kort, want het antwoord komt hardop.
 * Getypt: mag wat langer, met alinea's. `overMij` is wat je zelf in het tandwiel over jezelf schreef.
 */
export async function beantwoord(vraag: string, weet: string, opties: { gesproken: boolean; gesprek: Beurt[]; overMij: string; cloud: boolean }): Promise<AiAntwoord | null> {
  const lengte = opties.gesproken
    ? 'Antwoord kort: hooguit twee of drie zinnen, zonder opsommingen of opmaak, want het antwoord wordt hardop uitgesproken.'
    : 'Antwoord bondig: meestal een paar zinnen, hooguit ongeveer 150 woorden. Gewone tekst zonder markdown; een witregel tussen alinea\'s mag, en een korte lijst met regels die met "- " beginnen ook.';
  const uitleg = [
    'Je bent Atlas, de persoonlijke assistent van Vince, thuis in Heiloo. Je antwoordt in het Nederlands, vriendelijk en to the point, zoals een slimme huisgenoot.',
    'Je beantwoordt alle soorten vragen: over het huis en de dag van Vince, maar ook algemene kennis, uitleg, rekenen, koken, taal, ideeën en advies.',
    lengte,
    'Gebruik de gegevens hieronder voor vragen over het huis, de agenda, mail en het weer. Verzin geen afspraken, mails of apparaten; weet je iets niet zeker, zeg dat eerlijk.',
    claude && opties.cloud ? 'Voor actuele dingen (nieuws, sport, openingstijden, prijzen) mag je op internet zoeken. Noem geen links in je tekst; die laat Atlas zelf zien.' : 'Je kunt niet op internet zoeken; zeg dat als iemand naar actueel nieuws vraagt.',
    'Je kunt zelf niets in huis bedienen. Vraagt iemand dat, zeg dan welke opdracht er kan, zoals "woonkamer uit" of "dim bureau naar 30%".',
    ...(opties.overMij ? ['', 'Wat Vince over zichzelf vertelt:', opties.overMij] : []),
    '',
    'Wat Atlas nu weet:',
    weet,
  ].join('\n');
  const berichten: Bericht[] = [...opties.gesprek.flatMap((b): Bericht[] => [{ role: 'user', content: b.vraag }, { role: 'assistant', content: b.antwoord }]), { role: 'user', content: vraag }];
  const netjes = (t: string) => t.replace(/\*\*|__|[#`]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (claude && opties.cloud) {
    const a = await vraagClaude(uitleg, berichten, { max: opties.gesproken ? 1500 : 4000, wacht: 60_000, zoeken: true });
    if (a) return { ...a, tekst: opties.gesproken ? netjes(a.tekst).replace(/\s+/g, ' ') : netjes(a.tekst), bron: 'claude' };
  }
  const tekst = await chat([{ role: 'system', content: uitleg }, ...berichten], { temperatuur: 0.3, max: opties.gesproken ? 150 : 400, wacht: 90_000 });
  if (!tekst) return null;
  return { tekst: opties.gesproken ? netjes(tekst).replace(/\s+/g, ' ') : netjes(tekst), bron: 'lokaal' };
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
