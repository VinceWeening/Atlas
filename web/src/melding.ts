// Korte berichtjes onderin als iets niet lukt, zodat een schakelaar niet stil terugspringt.
const recent = new Map<string, number>();

export function meldFout(tekst: string) {
  // Dezelfde fout niet vaker dan eens per vijf seconden, anders stapelen ze op bij een server die even weg is.
  if (Date.now() - (recent.get(tekst) ?? 0) < 5_000) return;
  recent.set(tekst, Date.now());
  const plek = document.getElementById('toasts');
  if (!plek) return;
  const bericht = document.createElement('div');
  bericht.className = 'gl toast fout';
  bericht.setAttribute('role', 'status');
  const binnen = document.createElement('div');
  binnen.className = 'gl-in';
  const regel = document.createElement('p');
  regel.className = 'toast-kop';
  const stip = document.createElement('span');
  stip.className = 'stip warm';
  regel.append(stip, tekst);
  binnen.append(regel);
  bericht.append(binnen);
  plek.append(bericht);
  setTimeout(() => {
    bericht.classList.add('weg');
    setTimeout(() => bericht.remove(), 400);
  }, 5_000);
}

/** POST met JSON; gooit een fout met de tekst van de server als het niet lukt. */
export async function post(adres: string, body?: unknown) {
  const antwoord = await fetch(adres, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!antwoord.ok) {
    const data = await antwoord.json().catch(() => ({}));
    throw new Error(data.fout ?? `Server gaf ${antwoord.status}`);
  }
}
