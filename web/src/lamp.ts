// Schuifjes voor lampen: helderheid en, als de lamp het kan, warm of koel wit. Wordt gebruikt bij de kamer, bij
// Apparaten en bij de favorieten.
export type LampDelen = {
  helderheid: number | null;
  dimbaar: boolean;
  kleurtemp: { min: number; max: number; nu: number | null } | null;
};

let schuiven = 0;
/** Of iemand nu een schuifje vasthoudt. Schermen tekenen dan niet opnieuw, anders schiet het schuifje weg onder je vinger. */
export const schuiftNu = () => schuiven > 0;

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

async function stuur(id: string, opdracht: { helderheid?: number; kelvin?: number }) {
  try {
    const antwoord = await fetch(`/api/lamp/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opdracht),
    });
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
  } catch (fout) {
    console.error('Lamp instellen mislukt', fout);
  }
}

function schuif(opties: {
  klasse: string;
  label: string;
  min: number;
  max: number;
  stap: number;
  waarde: number;
  tekst: (w: number) => string;
  klaar: (w: number) => Promise<void>;
}) {
  const vak = maak('label', `schuif ${opties.klasse}`);
  const invoer = maak('input');
  invoer.type = 'range';
  invoer.min = String(opties.min);
  invoer.max = String(opties.max);
  invoer.step = String(opties.stap);
  invoer.value = String(opties.waarde);
  invoer.setAttribute('aria-label', opties.label);
  const waarde = maak('span', 'schuif-waarde', opties.tekst(opties.waarde));
  const vul = () => invoer.style.setProperty('--vul', `${((Number(invoer.value) - opties.min) / (opties.max - opties.min)) * 100}%`);
  vul();
  let vast = false;
  const los = () => {
    if (!vast) return;
    vast = false;
    // Even wachten met loslaten, zodat de ronde van Home Assistant die net binnenkomt de oude stand niet terugzet.
    setTimeout(() => (schuiven = Math.max(0, schuiven - 1)), 1500);
  };
  invoer.addEventListener('pointerdown', () => {
    if (!vast) schuiven++;
    vast = true;
  });
  invoer.addEventListener('pointerup', los);
  invoer.addEventListener('pointercancel', los);
  invoer.addEventListener('input', () => {
    waarde.textContent = opties.tekst(Number(invoer.value));
    vul();
  });
  invoer.addEventListener('change', async () => {
    schuiven++;
    await opties.klaar(Number(invoer.value));
    setTimeout(() => (schuiven = Math.max(0, schuiven - 1)), 1500);
    los();
  });
  vak.append(invoer, waarde);
  return vak;
}

/**
 * Helderheid en kleurtemperatuur onder een lamp. Geeft null als de lamp alleen aan en uit kan. Een uitgezette lamp toont
 * alleen de helderheid; schuiven zet hem dan aan op die stand.
 */
export function lampSchuiven(lamp: { id: string; naam: string; aan: boolean | null; bereikbaar: boolean; lamp?: LampDelen } & Partial<LampDelen>, na: () => void) {
  const delen: LampDelen | undefined = lamp.lamp ?? (lamp.dimbaar != null ? (lamp as LampDelen) : undefined);
  if (!delen?.dimbaar || !lamp.bereikbaar) return null;
  const vak = maak('div', 'lamp-schuiven');
  vak.append(
    schuif({
      klasse: 'helderheid',
      label: `Helderheid ${lamp.naam}`,
      min: 1,
      max: 100,
      stap: 1,
      waarde: lamp.aan ? (delen.helderheid ?? 100) : 1,
      tekst: (w) => `${w}%`,
      klaar: async (w) => {
        await stuur(lamp.id, { helderheid: w });
        na();
      },
    }),
  );
  const kt = delen.kleurtemp;
  if (lamp.aan && kt) {
    vak.append(
      schuif({
        klasse: 'kleurtemp',
        label: `Kleur wit ${lamp.naam}, van warm naar koel`,
        min: kt.min,
        max: kt.max,
        stap: 50,
        waarde: kt.nu ?? Math.round((kt.min + kt.max) / 2),
        tekst: (w) => (w < 3300 ? 'Warm' : w < 4800 ? 'Neutraal' : 'Koel'),
        klaar: async (w) => {
          await stuur(lamp.id, { kelvin: w });
          na();
        },
      }),
    );
  }
  return vak;
}
