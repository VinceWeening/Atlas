// Overzicht zelf indelen: elk blok en elke kolom kun je invouwen tot alleen de kop, en met de knop Indelen in de
// bovenbalk zet je blokken uit en weer aan zonder het tandwiel. Ingevouwen en uitgezet blijft bewaard op de server,
// dus pc en telefoon zien hetzelfde.

type Opties = {
  ingevouwen: () => string[];
  blokAan: (id: string) => boolean;
  bewaar: (deel: { ingevouwen?: string[]; blokken?: Record<string, boolean> }) => Promise<void>;
};

// Namen voor blokken zonder eigen kop.
const NAMEN: Record<string, string> = { dagstart: 'Ochtend en avond', camera: 'Camera', kamer: 'Kamer' };

const svg = (pad: string) =>
  `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pad}</svg>`;
const PIJL = svg('<path d="m6 9 6 6 6-6"/>');
const OOG = svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>');
const OOG_DICHT = svg('<path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.7M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

export function maakIndelen(o: Opties) {
  const app = document.querySelector<HTMLElement>('.app')!;
  const knop = document.getElementById('indelen-knop') as HTMLButtonElement;
  let lokaal: string[] | null = null;
  const ingevouwen = () => lokaal ?? o.ingevouwen();

  /** Blokken die op Overzicht in een kolom kunnen staan: alles met data-blok behalve de delen van het dock. */
  const blokken = () =>
    [...document.querySelectorAll<HTMLElement>('section[data-blok]')].filter((s) => !s.closest('.dock') && s.querySelector('.gl-in'));

  const naam = (s: HTMLElement) =>
    s.querySelector('.gl-in > .kop .lbl')?.textContent?.trim() || NAMEN[s.dataset.blok!] || s.getAttribute('aria-label') || s.dataset.blok!;

  async function wisselVouw(id: string) {
    const nu = ingevouwen();
    lokaal = nu.includes(id) ? nu.filter((x) => x !== id) : [...nu, id];
    pasToe();
    try {
      await o.bewaar({ ingevouwen: lokaal });
    } finally {
      lokaal = null;
    }
  }

  // Een balk per blok: de naam (zichtbaar als het blok is ingevouwen of verborgen), het oog bij Indelen en de pijl.
  for (const s of blokken()) {
    const id = s.dataset.blok!;
    const balk = maak('div', 'blok-balk');
    const titel = maak('span', 'lbl blok-naam', naam(s));
    const oog = maak('button', 'icoon-knop blok-oog');
    oog.type = 'button';
    oog.addEventListener('click', () => void o.bewaar({ blokken: { [id]: !o.blokAan(id) } }));
    const vouw = maak('button', 'icoon-knop blok-vouw');
    vouw.type = 'button';
    vouw.innerHTML = PIJL;
    vouw.addEventListener('click', () => void wisselVouw(id));
    balk.append(titel, oog, vouw);
    s.prepend(balk);
  }

  // Elke kolomkop krijgt ook een pijl: dan vouwt de hele kolom in.
  for (const kolom of document.querySelectorAll<HTMLElement>('.kolom')) {
    const kop = kolom.querySelector<HTMLElement>('.kolom-kop')!;
    const vouw = maak('button', 'kolom-vouw');
    vouw.type = 'button';
    vouw.innerHTML = PIJL;
    vouw.addEventListener('click', () => void wisselVouw(kolom.id));
    kop.append(vouw);
  }

  const hint = document.getElementById('indeel-hint')!;
  knop.addEventListener('click', () => {
    app.classList.toggle('indelen');
    pasToe();
  });
  document.getElementById('indeel-klaar')!.addEventListener('click', () => {
    app.classList.remove('indelen');
    pasToe();
    knop.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.classList.contains('indelen') && !document.querySelector('dialog[open], :popover-open')) {
      app.classList.remove('indelen');
      pasToe();
    }
  });

  /** Zet pijlen, ogen en labels goed. Wordt na elke wijziging van instellingen of scherm aangeroepen. */
  function pasToe() {
    const lijst = ingevouwen();
    const overzicht = app.classList.contains('overzicht');
    if (!overzicht) app.classList.remove('indelen');
    const indelen = app.classList.contains('indelen');
    knop.hidden = !overzicht;
    knop.setAttribute('aria-pressed', String(indelen));
    hint.hidden = !indelen;
    for (const s of blokken()) {
      const id = s.dataset.blok!;
      const dicht = lijst.includes(id);
      const aan = o.blokAan(id);
      const n = naam(s);
      s.classList.toggle('ingevouwen', dicht);
      s.querySelector('.blok-naam')!.textContent = n;
      const vouw = s.querySelector<HTMLButtonElement>('.blok-vouw')!;
      vouw.setAttribute('aria-expanded', String(!dicht));
      vouw.setAttribute('aria-label', `${n} ${dicht ? 'uitvouwen' : 'invouwen'}`);
      vouw.title = dicht ? 'Uitvouwen' : 'Invouwen';
      const oog = s.querySelector<HTMLButtonElement>('.blok-oog')!;
      oog.innerHTML = aan ? OOG : OOG_DICHT;
      oog.setAttribute('aria-pressed', String(!aan));
      oog.setAttribute('aria-label', `${n} ${aan ? 'verbergen' : 'tonen'}`);
      oog.title = aan ? 'Verbergen' : 'Tonen';
      oog.tabIndex = indelen ? 0 : -1;
    }
    for (const kolom of document.querySelectorAll<HTMLElement>('.kolom')) {
      const dicht = lijst.includes(kolom.id);
      kolom.classList.toggle('ingevouwen', dicht);
      const vouw = kolom.querySelector<HTMLButtonElement>('.kolom-vouw')!;
      const titel = kolom.querySelector('.kolom-kop')!.firstChild?.textContent ?? '';
      vouw.setAttribute('aria-expanded', String(!dicht));
      vouw.setAttribute('aria-label', `${titel} ${dicht ? 'uitvouwen' : 'invouwen'}`);
    }
  }

  return { pasToe };
}
