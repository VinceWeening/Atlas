// De opdrachtbalk: typ of zeg wat Atlas moet doen. De server begrijpt de zin en voert hem uit; hier zit alleen het
// venster, de microfoon en het antwoord. Spraak gebruikt de spraakherkenning van de browser als die er is (Chrome, Edge,
// Safari op iPhone); anders typ je.

type Antwoord = { tekst: string; gedaan: boolean; scherm?: 'thuis' | 'overzicht' | 'apparaten' | 'cameras' };
type Opties = {
  /** Of de opdrachtbalk aan staat in het tandwiel. */
  aan: () => boolean;
  naarScherm: (scherm: NonNullable<Antwoord['scherm']>) => void;
  /** Na een opdracht die iets veranderde: het huis opnieuw ophalen. */
  ververs: () => void;
  /** Voorbeeldzinnen met de echte namen uit het huis. */
  tips: () => string[];
};

type Herkenning = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const HerkenningKlasse = ((window as unknown as Record<string, unknown>).SpeechRecognition ??
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => Herkenning) | undefined;
export const kanSpraak = !!HerkenningKlasse;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function startOpdracht(opties: Opties) {
  const venster = $<HTMLDialogElement>('opdracht');
  const veld = $<HTMLInputElement>('opdracht-veld');
  const antwoord = $('opdracht-antwoord');
  const tips = $('opdracht-tips');
  const mic = $<HTMLButtonElement>('opdracht-mic');
  const geschiedenis: string[] = [];
  let terug = -1;
  let luistert: Herkenning | null = null;
  let bezig = false;

  mic.hidden = !kanSpraak;

  const zeg = (tekst: string, soort: 'gewoon' | 'gedaan' | 'fout' | 'luistert' = 'gewoon') => {
    antwoord.textContent = tekst;
    antwoord.dataset.soort = soort;
  };

  const tekenTips = () => {
    tips.replaceChildren(
      ...opties.tips().map((tip) => {
        const knop = document.createElement('button');
        knop.type = 'button';
        knop.className = 'opdracht-tip';
        knop.textContent = tip;
        knop.addEventListener('click', () => {
          veld.value = tip;
          void verstuur(tip, false);
        });
        return knop;
      }),
    );
  };

  function open(spreken = false) {
    if (!opties.aan()) return;
    if (!venster.open) {
      zeg('');
      veld.value = '';
      tekenTips();
      venster.showModal();
    }
    veld.focus();
    if (spreken) luister();
  }

  function sluit() {
    luistert?.stop();
    if (venster.open) venster.close();
  }

  /** Een kort antwoord hardop, alleen als de opdracht ook gesproken was. */
  function spreek(tekst: string) {
    if (!('speechSynthesis' in window)) return;
    const zin = new SpeechSynthesisUtterance(tekst);
    zin.lang = 'nl-NL';
    const stem = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('nl'));
    if (stem) zin.voice = stem;
    zin.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(zin);
  }

  async function verstuur(tekst: string, gesproken: boolean) {
    tekst = tekst.trim();
    if (!tekst || bezig) return;
    bezig = true;
    venster.setAttribute('aria-busy', 'true');
    geschiedenis.unshift(tekst);
    geschiedenis.splice(10);
    terug = -1;
    try {
      const a = await fetch('/api/opdracht', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tekst }) });
      const data = (await a.json()) as Antwoord & { fout?: string };
      if (!a.ok) throw new Error(data.fout ?? `Server gaf ${a.status}`);
      zeg(data.tekst, data.gedaan ? 'gedaan' : 'gewoon');
      if (gesproken) spreek(data.tekst);
      if (data.gedaan) opties.ververs();
      veld.value = '';
      if (data.scherm) {
        opties.naarScherm(data.scherm);
        setTimeout(sluit, 350);
      }
    } catch (fout) {
      zeg(fout instanceof Error ? fout.message : 'Dat lukte niet', 'fout');
    } finally {
      bezig = false;
      venster.removeAttribute('aria-busy');
    }
  }

  function luister() {
    if (!HerkenningKlasse) {
      zeg('Spraak werkt in deze app nog niet. Typ je opdracht.', 'gewoon');
      return;
    }
    if (luistert) {
      luistert.stop();
      return;
    }
    const r = new HerkenningKlasse();
    r.lang = 'nl-NL';
    r.interimResults = true;
    r.continuous = false;
    let klaar = '';
    r.onresult = (e) => {
      const laatste = e.results[e.results.length - 1];
      veld.value = laatste[0].transcript;
      if (laatste.isFinal) klaar = laatste[0].transcript;
    };
    r.onerror = (e) => {
      zeg(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Atlas mag de microfoon niet gebruiken.' : e.error === 'no-speech' ? 'Ik hoorde niets.' : 'Spraak lukte niet. Typ je opdracht.', 'fout');
    };
    r.onend = () => {
      luistert = null;
      mic.setAttribute('aria-pressed', 'false');
      venster.classList.remove('luistert');
      if (klaar) void verstuur(klaar, true);
    };
    luistert = r;
    mic.setAttribute('aria-pressed', 'true');
    venster.classList.add('luistert');
    zeg('Ik luister…', 'luistert');
    r.start();
  }

  $('opdracht-vorm').addEventListener('submit', (e) => {
    e.preventDefault();
    void verstuur(veld.value, false);
  });
  veld.addEventListener('keydown', (e) => {
    // Pijl omhoog haalt de vorige opdracht terug, zoals in een terminal.
    if (e.key === 'ArrowUp' && geschiedenis.length) {
      terug = Math.min(geschiedenis.length - 1, terug + 1);
      veld.value = geschiedenis[terug];
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && terug >= 0) {
      terug -= 1;
      veld.value = terug >= 0 ? geschiedenis[terug] : '';
      e.preventDefault();
    }
  });
  mic.addEventListener('click', luister);
  // Klik naast het venster sluit het.
  venster.addEventListener('click', (e) => {
    if (e.target === venster) sluit();
  });
  venster.addEventListener('close', () => luistert?.stop());

  document.addEventListener('keydown', (e) => {
    const doel = e.target as HTMLElement;
    const inVeld = !!doel.closest('input, select, textarea, [contenteditable]');
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (venster.open) sluit();
      else open();
      e.preventDefault();
    } else if (e.key === '/' && !inVeld && !document.querySelector('dialog[open]')) {
      open();
      e.preventDefault();
    }
  });

  return { open };
}
