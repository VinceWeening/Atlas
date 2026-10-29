// Het tandwiel: blokken aan/uit, startscherm, belangrijke data en de Google-koppeling.
type Scherm = 'thuis' | 'overzicht';
export type Datum = { id: string; titel: string; datum: string; van: string | null };
export type Meldingen = { pc: boolean; telefoon: boolean; toestel: string | null; soorten: string[]; camerasUit: string[]; wachttijd: number };
export type Instellingen = {
  blokken: Record<string, boolean>;
  start: { breed: Scherm; smal: Scherm };
  belangrijk: Datum[];
  meldingen: Meldingen;
};
type Opties = { frigate: { ingesteld: boolean; bereikbaar: boolean }; cameras: string[]; toestellen: { id: string; naam: string }[]; soorten: string[] };

const SOORTNAMEN: Record<string, string> = {
  person: 'Personen',
  car: "Auto's",
  bicycle: 'Fietsen',
  motorcycle: 'Motoren',
  dog: 'Honden',
  cat: 'Katten',
  bird: 'Vogels',
  package: 'Pakketten',
};
const cameraNaam = (camera: string) => camera.replace(/_/g, ' ').replace(/^\w/, (l) => l.toUpperCase());
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

const BLOKNAMEN: [string, string][] = [
  ['huis', 'Huis (plattegrond)'],
  ['vandaag', 'Vandaag'],
  ['belangrijk', 'Belangrijk'],
  ['mail', 'Mail'],
  ['kamer', 'Kamer en lampen'],
  ['camera', 'Camera'],
  ['scenes', 'Scènes'],
  ['hud', 'Statusregel boven'],
];

function schakelaarRij(naam: string, aan: boolean, wissel: (aan: boolean) => Promise<void>) {
  const rij = maak('div', 'lamp');
  rij.append(maak('div', 'lamp-info', naam));
  const schakelaar = knop('', 'schakelaar');
  schakelaar.setAttribute('role', 'switch');
  schakelaar.setAttribute('aria-checked', String(aan));
  schakelaar.setAttribute('aria-label', naam);
  schakelaar.addEventListener('click', async () => {
    aan = !aan;
    schakelaar.setAttribute('aria-checked', String(aan));
    try {
      await wissel(aan);
    } catch {
      aan = !aan;
      schakelaar.setAttribute('aria-checked', String(aan));
    }
  });
  rij.append(schakelaar);
  return rij;
}

export function instellingen(terug: { google: () => void; opgeslagen: (inst: Instellingen) => void }) {
  const venster = document.getElementById('instellingen') as HTMLDialogElement;
  const inhoud = document.getElementById('instellingen-inhoud')!;
  const naVerandering = terug.google;

  async function bewaar(deel: { [K in keyof Instellingen]?: Partial<Instellingen[K]> }) {
    const inst: Instellingen = await stuur('/api/instellingen', 'PUT', deel);
    terug.opgeslagen(inst);
    return inst;
  }

  async function tekenAlgemeen() {
    let inst: Instellingen;
    try {
      inst = await (await fetch('/api/instellingen')).json();
    } catch {
      return [maak('p', 'muted', 'De server is niet bereikbaar.')];
    }

    const blokken = maak('section', 'inst-sectie');
    blokken.append(
      maak('h3', 'lbl', 'BLOKKEN'),
      maak('p', 'muted klein', 'Staat het huis uit, dan gaat het naar de achtergrond. Met de huisknop bovenin haal je het weer naar voren.'),
    );
    for (const [id, naam] of BLOKNAMEN)
      blokken.append(schakelaarRij(naam, inst.blokken[id] !== false, async (aan) => void (inst = await bewaar({ blokken: { [id]: aan } }))));

    const start = maak('section', 'inst-sectie');
    start.append(maak('h3', 'lbl', 'STARTSCHERM'));
    for (const [soort, naam] of [['breed', 'Op de pc'], ['smal', 'Op de telefoon']] as const) {
      const rij = maak('div', 'lamp');
      const segment = maak('div', 'segment inst-keuze');
      const knoppen = (['thuis', 'overzicht'] as const).map((scherm) => {
        const k = knop(scherm === 'thuis' ? 'Thuis' : 'Overzicht', '');
        k.setAttribute('aria-pressed', String(inst.start[soort] === scherm));
        k.addEventListener('click', async () => {
          inst = await bewaar({ start: { ...inst.start, [soort]: scherm } });
          knoppen.forEach((b) => b.setAttribute('aria-pressed', String(b === k)));
        });
        return k;
      });
      segment.append(...knoppen);
      rij.append(maak('div', 'lamp-info', naam), segment);
      start.append(rij);
    }

    const data = maak('section', 'inst-sectie');
    data.append(
      maak('h3', 'lbl', 'BELANGRIJKE DATA'),
      maak('p', 'muted klein', 'Een deadline heeft alleen een einddatum. Vul ook "van" in voor een periode, zoals een stage.'),
    );
    const regels = maak('div');
    const regel = (d?: Datum) => {
      const r = maak('div', 'inst-datum');
      r.dataset.id = d?.id ?? '';
      const titel = maak('input', 'inst-veld');
      titel.placeholder = 'Naam';
      titel.maxLength = 80;
      titel.value = d?.titel ?? '';
      titel.setAttribute('aria-label', 'Naam');
      const van = maak('input', 'inst-veld');
      van.type = 'date';
      van.value = d?.van ?? '';
      van.setAttribute('aria-label', 'Van (optioneel)');
      const tot = maak('input', 'inst-veld');
      tot.type = 'date';
      tot.value = d?.datum ?? '';
      tot.setAttribute('aria-label', 'Datum of t/m');
      const weg = knop('×', 'knop zacht');
      weg.setAttribute('aria-label', 'Regel verwijderen');
      weg.addEventListener('click', () => r.remove());
      r.append(titel, van, tot, weg);
      return r;
    };
    const kop = maak('div', 'inst-datum inst-kop');
    kop.append(maak('span', 'klein muted', 'Naam'), maak('span', 'klein muted', 'Van (optioneel)'), maak('span', 'klein muted', 'Datum / t/m'), maak('span'));
    regels.append(kop, ...inst.belangrijk.map(regel));
    const toevoegen = knop('Regel toevoegen', 'knop zacht');
    toevoegen.addEventListener('click', () => regels.append(regel()));
    const opslaan = knop('Opslaan');
    const melding = maak('p', 'klein muted');
    melding.setAttribute('role', 'status');
    opslaan.addEventListener('click', async () => {
      const lijst = [...regels.querySelectorAll<HTMLElement>('.inst-datum[data-id]')]
        .map((r) => {
          const [titel, van, tot] = r.querySelectorAll('input');
          return { id: r.dataset.id || undefined, titel: titel.value, van: van.value || null, datum: tot.value };
        })
        .filter((d) => d.titel.trim() || d.datum);
      try {
        inst = await bewaar({ belangrijk: lijst as Datum[] });
        regels.replaceChildren(kop, ...inst.belangrijk.map(regel));
        melding.textContent = 'Opgeslagen.';
      } catch (fout) {
        melding.textContent = (fout as Error).message;
      }
    });
    const rij = maak('div', 'inst-rij');
    rij.append(toevoegen, opslaan);
    data.append(regels, rij, melding);

    return [blokken, start, data, await tekenMeldingen(inst, (nieuw) => (inst = nieuw))];
  }

  async function tekenMeldingen(inst: Instellingen, zet: (inst: Instellingen) => void) {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'MELDINGEN'));
    let opties: Opties;
    try {
      opties = await (await fetch('/api/meldingen/opties')).json();
    } catch {
      sectie.append(maak('p', 'muted', 'De server is niet bereikbaar.'));
      return sectie;
    }
    // Eigen kopie die meteen bijgewerkt wordt, zodat snel na elkaar klikken elkaar niet overschrijft.
    const lokaal = { ...inst.meldingen };
    const m = () => lokaal;
    const bewaarM = async (deel: Partial<Meldingen>) => {
      const vorig = { ...lokaal };
      Object.assign(lokaal, deel);
      try {
        zet(await bewaar({ meldingen: deel }));
      } catch (fout) {
        Object.assign(lokaal, vorig);
        throw fout;
      }
    };

    if (!opties.frigate.ingesteld)
      sectie.append(maak('p', 'muted klein', 'Frigate is nog niet ingesteld. Vul FRIGATE_URL in bij de app Atlas in ZimaOS, bijvoorbeeld http://192.168.1.76:5000. De stappen staan in de README.'));
    else if (!opties.frigate.bereikbaar) sectie.append(maak('p', 'klein warm', 'Frigate reageert niet. Klopt FRIGATE_URL, en staat poort 5000 open?'));

    sectie.append(
      schakelaarRij('Op de pc', m().pc, (aan) => bewaarM({ pc: aan })),
      schakelaarRij('Op de telefoon', m().telefoon, (aan) => bewaarM({ telefoon: aan })),
    );

    const toestelRij = maak('div', 'lamp');
    const keuze = maak('select', 'kamer-keuze');
    keuze.setAttribute('aria-label', 'Telefoon voor meldingen');
    keuze.append(Object.assign(maak('option', undefined, opties.toestellen.length ? 'Kies je telefoon' : 'Geen telefoon gevonden'), { value: '' }));
    for (const t of opties.toestellen) keuze.append(Object.assign(maak('option', undefined, t.naam), { value: t.id }));
    keuze.value = m().toestel ?? '';
    keuze.addEventListener('change', () => bewaarM({ toestel: keuze.value || null }));
    toestelRij.append(maak('div', 'lamp-info', 'Telefoon'), keuze);
    sectie.append(toestelRij);

    sectie.append(maak('p', 'inst-label', 'Waarvoor'));
    const soorten = maak('div', 'segment inst-keuze inst-chips');
    for (const soort of opties.soorten) {
      const k = knop(SOORTNAMEN[soort] ?? soort, '');
      k.setAttribute('aria-pressed', String(m().soorten.includes(soort)));
      k.addEventListener('click', async () => {
        const aan = !m().soorten.includes(soort);
        k.setAttribute('aria-pressed', String(aan));
        await bewaarM({ soorten: aan ? [...m().soorten, soort] : m().soorten.filter((s) => s !== soort) }).catch(() => k.setAttribute('aria-pressed', String(!aan)));
      });
      soorten.append(k);
    }
    sectie.append(soorten);

    if (opties.cameras.length) {
      sectie.append(maak('p', 'inst-label', "Camera's"));
      for (const camera of opties.cameras)
        sectie.append(
          schakelaarRij(cameraNaam(camera), !m().camerasUit.includes(camera), (aan) =>
            bewaarM({ camerasUit: aan ? m().camerasUit.filter((c) => c !== camera) : [...m().camerasUit, camera] }),
          ),
        );
    }

    const wachtRij = maak('div', 'lamp');
    const wacht = maak('select', 'kamer-keuze');
    wacht.setAttribute('aria-label', 'Stilte na een melding');
    for (const minuten of [0, 1, 2, 5, 10, 30])
      wacht.append(Object.assign(maak('option', undefined, minuten === 0 ? 'Geen' : `${minuten} min`), { value: String(minuten) }));
    wacht.value = String(m().wachttijd);
    wacht.addEventListener('change', () => bewaarM({ wachttijd: Number(wacht.value) }));
    wachtRij.append(maak('div', 'lamp-info', 'Stilte per camera na een melding'), wacht);
    sectie.append(wachtRij);

    const test = knop('Testmelding', 'knop zacht');
    const melding = maak('p', 'klein muted');
    melding.setAttribute('role', 'status');
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        const { telefoon } = await stuur('/api/meldingen/test', 'POST');
        melding.textContent = `Verstuurd. ${telefoon ?? ''}`.trim();
      } catch (fout) {
        melding.textContent = (fout as Error).message;
      }
      test.disabled = false;
    });
    sectie.append(test, melding);
    return sectie;
  }

  async function teken() {
    const google = maak('div');
    inhoud.replaceChildren(...(await tekenAlgemeen()), google);
    await tekenGoogle(google);
  }

  async function tekenGoogle(plek: HTMLElement) {
    const sectie = maak('section', 'inst-sectie');
    sectie.append(maak('h3', 'lbl', 'GOOGLE AGENDA EN GMAIL'));
    plek.replaceChildren(sectie);
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
          await tekenGoogle(plek);
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
      await tekenGoogle(plek);
    });
    sectie.append(ontkoppel);
  }

  document.getElementById('tandwiel')!.addEventListener('click', () => {
    venster.showModal();
    teken();
  });
  document.getElementById('instellingen-sluit')!.addEventListener('click', () => venster.close());
  // Klikken naast het venster sluit het ook.
  venster.addEventListener('click', (e) => e.target === venster && venster.close());
}
