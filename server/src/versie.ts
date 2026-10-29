// Kijkt of er een nieuwere Atlas klaarstaat: de nieuwste geslaagde build van de server op GitHub tegenover de versie
// die nu draait. Bijwerken zelf doet Vince op ZimaOS; Atlas krijgt bewust geen toegang tot Docker.
const REPO = 'VinceWeening/Atlas';
const huidig = process.env.ATLAS_VERSION ?? 'dev';

let nieuwste: { sha: string; datum: string } | null = null;
let gekeken = 0;

async function kijk() {
  gekeken = Date.now();
  try {
    const antwoord = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/server.yml/runs?branch=main&status=success&per_page=1`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'atlas' },
      signal: AbortSignal.timeout(8000),
    });
    if (!antwoord.ok) return;
    const data = (await antwoord.json()) as { workflow_runs?: { head_sha: string; updated_at: string }[] };
    const run = data.workflow_runs?.[0];
    if (run) nieuwste = { sha: run.head_sha, datum: run.updated_at };
  } catch {
    // Geen internet of GitHub even weg; later opnieuw.
  }
}

export async function versie() {
  // Hooguit eens per half uur bij GitHub kijken.
  if (Date.now() - gekeken > 30 * 60_000) await kijk();
  return {
    huidig: huidig.slice(0, 7),
    nieuwste: nieuwste?.sha.slice(0, 7) ?? null,
    nieuw: huidig !== 'dev' && !!nieuwste && nieuwste.sha !== huidig,
    datum: nieuwste?.datum ?? null,
  };
}
