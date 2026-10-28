// Het tandwiel: voorlopig alleen de Google-koppeling en welke agenda's meedoen. Blokken aan/uit volgen in stap 2.
type Agenda = { id: string; naam: string; kleur: string | null; aan: boolean };
type GoogleStatus = { ingesteld: boolean; gekoppeld: boolean; agendas: Agenda[] };

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

function knop(tekst: string, klasse = 'knop') {
  const k = maak('button', klasse, tekst);
  k.type = 'button';
  return k;
}

async function stuur(adres: string, methode: string, body?: unknown) {
  const antwoord = await fetch(adres, {
    method: methode,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await antwoord.json().catch(() => ({}));
  if (!antwoord.ok) throw new Error(data.fout ?? `Server gaf ${antwoord.status}`);
  return data;
}

export function instellingen(naVerandering: () => void) {
  const venster = document.getElementById('instellingen') as HTMLDialogElement;
  const inhoud = document.getElementById('instellingen-inhoud')!;

  async function tekenGoogle() {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'GOOGLE AGENDA EN GMAIL'));
    inhoud.replaceChildren(sectie);
    let status: GoogleStatus;
    try {
      status = await (await fetch('/api/google')).json();
    } catch {
      sectie.append(maak('p', 'muted', 'De server is niet bereikbaar.'));
      return;
    }

    if (!status.ingesteld) {
      sectie.append(
        maak('p', 'muted', 'Nog niet ingesteld. Vul GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET in bij de app Atlas in ZimaOS. De stappen staan in de README.'),
      );
      return;
    }

    if (!status.gekoppeld) {
      const uitleg = maak('ol', 'inst-stappen');
      for (const regel of [
        'Klik op "Open Google" en geef toestemming.',
        'Je komt daarna op een pagina die niet laadt. Dat hoort zo.',
        'Kopieer het adres uit de adresbalk en plak het hieronder.',
      ])
        uitleg.append(maak('li', undefined, regel));
      const open = knop('Open Google');
      const link = maak('a', 'klein muted');
      link.target = '_blank';
      link.rel = 'noopener';
      const veld = maak('input', 'inst-veld');
      veld.placeholder = 'http://127.0.0.1:8790/google?state=…&code=…';
      veld.setAttribute('aria-label', 'Adres uit de adresbalk');
      const koppel = knop('Koppelen');
      const melding = maak('p', 'klein muted');
      melding.setAttribute('role', 'status');

      open.addEventListener('click', async () => {
        try {
          const { adres } = await stuur('/api/google/start', 'POST');
          link.href = adres;
          link.textContent = 'Opent er niets? Klik dan hier, of open Atlas in je browser en koppel daar.';
          window.open(adres, '_blank', 'noopener');
        } catch (fout) {
          melding.textContent = (fout as Error).message;
        }
      });
      koppel.addEventListener('click', async () => {
        koppel.disabled = true;
        melding.textContent = 'Bezig met koppelen…';
        try {
          await stuur('/api/google/koppel', 'POST', { adres: veld.value });
          naVerandering();
          await tekenGoogle();
        } catch (fout) {
          melding.textContent = (fout as Error).message;
          koppel.disabled = false;
        }
      });
      const rij = maak('div', 'inst-rij');
      rij.append(veld, koppel);
      sectie.append(uitleg, open, link, rij, melding);
      return;
    }

    sectie.append(maak('p', 'muted klein', "Gekoppeld. Kies welke agenda's Atlas laat zien."));
    for (const agenda of status.agendas) {
      const rij = maak('div', 'lamp');
      const naam = maak('div', 'lamp-info');
      const stip = maak('span', 'agenda-stip');
      stip.style.background = agenda.kleur ?? 'var(--ijs)';
      naam.append(stip, maak('span', undefined, agenda.naam));
      const schakelaar = knop('', 'schakelaar');
      schakelaar.setAttribute('role', 'switch');
      schakelaar.setAttribute('aria-checked', String(agenda.aan));
      schakelaar.setAttribute('aria-label', `${agenda.naam} tonen`);
      schakelaar.addEventListener('click', async () => {
        agenda.aan = !agenda.aan;
        schakelaar.setAttribute('aria-checked', String(agenda.aan));
        try {
          await stuur('/api/google/agenda', 'POST', { id: agenda.id, aan: agenda.aan });
          naVerandering();
        } catch {
          agenda.aan = !agenda.aan;
          schakelaar.setAttribute('aria-checked', String(agenda.aan));
        }
      });
      rij.append(naam, schakelaar);
      sectie.append(rij);
    }
    const ontkoppel = knop('Google ontkoppelen', 'knop zacht');
    ontkoppel.addEventListener('click', async () => {
      await stuur('/api/google', 'DELETE');
      naVerandering();
      await tekenGoogle();
    });
    sectie.append(ontkoppel);
  }

  document.getElementById('tandwiel')!.addEventListener('click', () => {
    venster.showModal();
    tekenGoogle();
  });
  document.getElementById('instellingen-sluit')!.addEventListener('click', () => venster.close());
  // Klikken naast het venster sluit het ook.
  venster.addEventListener('click', (e) => e.target === venster && venster.close());
}
