// Spraak die thuis blijft: een opname uit de app gaat naar een eigen Whisper-server (bijvoorbeeld Speaches of
// faster-whisper-server op ZimaOS) en komt terug als tekst. Die server spreekt de OpenAI-taal, dus elk programma dat
// /v1/audio/transcriptions kent werkt. Zonder WHISPER_URL gebruikt de app de spraakherkenning van de browser.

const adres = process.env.WHISPER_URL?.trim().replace(/\/+$/, '') || null;
const model = process.env.WHISPER_MODEL?.trim() || 'Systran/faster-whisper-small';

export const spraakAan = () => !!adres;

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
