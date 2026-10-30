// Spraak die thuis blijft: een opname uit de app gaat naar een eigen Whisper-server (bijvoorbeeld Speaches of
// faster-whisper-server op ZimaOS) en komt terug als tekst. Die server spreekt de OpenAI-taal, dus elk programma dat
// /v1/audio/transcriptions kent werkt. Zonder WHISPER_URL gebruikt de app de spraakherkenning van de browser.

const adres = process.env.WHISPER_URL?.trim().replace(/\/+$/, '') || null;
const model = process.env.WHISPER_MODEL?.trim() || 'Systran/faster-whisper-small';

export const spraakAan = () => !!adres;
export const spraakModel = model;

/** Haalt het Whisper-model op als de server het nog niet heeft (Speaches doet dat niet vanzelf). */
export async function zorgVoorSpraakModel(log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (!adres) return;
  try {
    const lijst = (await (await fetch(`${adres}/v1/models`, { signal: AbortSignal.timeout(5000) })).json()) as { data?: { id: string }[] };
    if (lijst.data?.some((m) => m.id === model)) return;
    log.info(`Spraak: model ${model} ophalen`);
    const antwoord = await fetch(`${adres}/v1/models/${model}`, { method: 'POST', signal: AbortSignal.timeout(30 * 60_000) });
    log.info(`Spraak: model ${model} ${antwoord.ok ? 'staat klaar' : `niet opgehaald (${antwoord.status})`}`);
  } catch {
    log.warn('Spraak: Whisper-server niet bereikbaar, model niet gecontroleerd');
  }
}

/** Of de Whisper-server antwoordt; voor het controlescherm. */
export async function spraakBereikbaar() {
  if (!adres) return null;
  try {
    const antwoord = await fetch(`${adres}/v1/models`, { signal: AbortSignal.timeout(4000) });
    return antwoord.status < 500;
  } catch {
    return false;
  }
}

export async function naarTekst(audio: Buffer, type: string) {
  if (!adres) throw new Error('Geen WHISPER_URL ingesteld');
  const vorm = new FormData();
  const extensie = type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mp4') ? 'mp4' : 'webm';
  vorm.append('file', new Blob([new Uint8Array(audio)], { type }), `opname.${extensie}`);
  vorm.append('model', model);
  vorm.append('language', 'nl');
  // Een hint met de woorden die Atlas kent helpt Whisper bij korte opdrachten.
  vorm.append('prompt', 'Woonkamer, keuken, bureau, zolder, lampen aan, lampen uit, dimmen, filmavond, welterusten.');
  const antwoord = await fetch(`${adres}/v1/audio/transcriptions`, { method: 'POST', body: vorm, signal: AbortSignal.timeout(30_000) });
  if (!antwoord.ok) throw new Error(`Whisper gaf ${antwoord.status}`);
  const data = (await antwoord.json()) as { text?: string };
  return (data.text ?? '').trim();
}
