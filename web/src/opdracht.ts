// De opdrachtbalk: typ of zeg wat Atlas moet doen, of stel een vraag. De server begrijpt de zin en voert hem uit, of laat
// een AI antwoorden; hier zit alleen het venster, de microfoon, het antwoord en het lopende gesprek. Spraak gebruikt de spraakherkenning van de browser als die er is (Chrome, Edge,
// Safari op iPhone); anders typ je.

type Antwoord = {
  tekst: string;
  gedaan: boolean;
  scherm?: 'thuis' | 'overzicht' | 'apparaten' | 'cameras';
  begrepen?: string;
  ai?: boolean;
  bron?: 'lokaal' | 'claude';
  bronnen?: { titel: string; url: string }[];
};
type Beurt = { vraag: string; antwoord: string };
// Na tien minuten stilte begint een nieuw gesprek; dan gaat een losse vraag niet meer over het vorige onderwerp.
const GESPREK_DUUR = 10 * 60_000;
type Opties = {
  /** Of de opdrachtbalk aan staat in het tandwiel. */
  aan: () => boolean;
  naarScherm: (scherm: NonNullable<Antwoord['scherm']>) => void;
  /** Na een opdracht die iets veranderde: het huis opnieuw ophalen. */
  ververs: () => void;
  /** Voorbeeldzinnen met de echte namen uit het huis. */
  tips: () => string[];
  /** Of een antwoord hardop mag als je iets zei (tandwiel › Spraak en AI). */
  hardop: () => boolean;
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
const kanOpnemen = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
/** Of spreken kan: met de spraakherkenning van de browser, of met een opname voor de eigen Whisper-server. */
export const kanSpraak = !!HerkenningKlasse || kanOpnemen;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function startOpdracht(opties: Opties) {
  const venster = $<HTMLDialogElement>('opdracht');
  const veld = $<HTMLInputElement>('opdracht-veld');
  const antwoord = $('opdracht-antwoord');
  const tips = $('opdracht-tips');
  const mic = $<HTMLButtonElement>('opdracht-mic');
  const log = $('opdracht-gesprek');
  const gesprek: (Beurt & { bron?: Antwoord['bron']; bronnen?: Antwoord['bronnen'] })[] = [];
  let laatsteVraag = 0;
  const geschiedenis: string[] = [];
  let terug = -1;
  let luistert: Herkenning | null = null;
  let bezig = false;

  // Staat er een eigen Whisper-server klaar, dan gaat spraak daarheen: dat blijft thuis en werkt ook in de Windows-app.
  let serverSpraak = false;
  // Beantwoordt een AI vrije vragen, dan staan er ook vragen tussen de voorbeelden.
  let vragen = false;
  let opname: { stop: () => void } | null = null;
  mic.hidden = !HerkenningKlasse;
  fetch('/api/spraak')
    .then((a) => (a.ok ? a.json() : { aan: false }))
    .then((d: { aan: boolean; vragen?: boolean }) => {
      serverSpraak = d.aan && kanOpnemen;
      vragen = !!d.vragen;
      mic.hidden = !HerkenningKlasse && !serverSpraak;
    })
    .catch(() => {});

  const zeg = (tekst: string, soort: 'gewoon' | 'gedaan' | 'fout' | 'luistert' | 'denkt' = 'gewoon') => {
    antwoord.textContent = tekst;
    antwoord.dataset.soort = soort;
    // Opnieuw afspelen: het nieuwe antwoord komt zacht binnen, ook als het vorige er nog stond.
    antwoord.classList.remove('nieuw');
    void antwoord.offsetWidth;
    antwoord.classList.add('nieuw');
  };

  /** Het gesprek met de AI: elke vraag klein, het antwoord eronder, met waar het vandaan komt. */
  const tekenGesprek = () => {
    log.replaceChildren();
    // Tijdens een gesprek geen voorbeelden eronder; die zijn er weer bij een nieuw gesprek.
    tips.hidden = gesprek.length > 0;
    if (!gesprek.length) return;
    const kop = document.createElement('div');
    kop.className = 'opdracht-gesprek-kop';
    const nieuw = document.createElement('button');
    nieuw.type = 'button';
    nieuw.className = 'opdracht-nieuw';
    nieuw.textContent = 'Nieuw gesprek';
    nieuw.addEventListener('click', () => {
      gesprek.length = 0;
      tekenGesprek();
      veld.focus();
    });
    kop.append(nieuw);
    log.append(kop);
    for (const b of gesprek) {
      const vraag = document.createElement('p');
      vraag.className = 'opdracht-vraag';
      vraag.textContent = b.vraag;
      const tekst = document.createElement('p');
      tekst.className = 'opdracht-ai';
      tekst.textContent = b.antwoord;
      const onder = document.createElement('p');
      onder.className = 'opdracht-bron';
      // Klein eronder: dit kwam van een AI, niet uit Home Assistant, en welke pagina's Claude erbij zocht.
      onder.append(b.bron === 'claude' ? 'Claude' : 'lokale AI');
      for (const link of b.bronnen ?? []) {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = new URL(link.url).hostname.replace(/^www\./, '');
        a.title = link.titel;
        onder.append(' · ', a);
      }
      log.append(vraag, tekst, onder);
    }
    log.lastElementChild?.scrollIntoView({ block: 'nearest' });
  };

  const tekenTips = () => {
    tips.replaceChildren(
      ...[...opties.tips(), ...(vragen ? ['Wat staat er vandaag nog?', 'Hoe lang moet een ei koken?'] : [])].map((tip) => {
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
      if (gesprek.length && Date.now() - laatsteVraag > GESPREK_DUUR) gesprek.length = 0;
      tekenGesprek();
      tekenTips();
      venster.showModal();
    }
    veld.focus();
    if (spreken) luister();
  }

  function sluit() {
    luistert?.stop();
    opname?.stop();
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
    if (gesprek.length && Date.now() - laatsteVraag > GESPREK_DUUR) {
      gesprek.length = 0;
      tekenGesprek();
    }
    laatsteVraag = Date.now();
    // Een vraag aan de AI duurt een paar seconden; dan laten zien dat Atlas nadenkt.
    const denkt = setTimeout(() => zeg('Even nadenken…', 'denkt'), 900);
    try {
      const a = await fetch('/api/opdracht', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tekst, gesproken, gesprek: gesprek.slice(-6).map(({ vraag, antwoord }) => ({ vraag, antwoord })) }),
      });
      const data = (await a.json()) as Antwoord & { fout?: string };
      if (!a.ok) throw new Error(data.fout ?? `Server gaf ${a.status}`);
      if (data.ai) {
        // Een antwoord van de AI komt in het gesprek, zodat je kunt doorvragen.
        gesprek.push({ vraag: tekst, antwoord: data.tekst, bron: data.bron, bronnen: data.bronnen });
        gesprek.splice(0, gesprek.length - 6);
        zeg('');
        tekenGesprek();
      } else {
        // Herschreef de AI de zin, dan zie je wat Atlas ervan maakte.
        zeg(data.begrepen ? `${data.tekst} (begrepen als “${data.begrepen}”)` : data.tekst, data.gedaan ? 'gedaan' : 'gewoon');
      }
      if (gesproken && opties.hardop()) spreek(data.tekst);
      if (data.gedaan) {
        opties.ververs();
        // De voorbeelden volgen het huis: was de woonkamer net uitgezet, dan staat er nu "woonkamer aan".
        setTimeout(tekenTips, 900);
      }
      veld.value = '';
      if (data.scherm) {
        opties.naarScherm(data.scherm);
        setTimeout(sluit, 350);
      }
    } catch (fout) {
      zeg(fout instanceof Error ? fout.message : 'Dat lukte niet', 'fout');
    } finally {
      clearTimeout(denkt);
      bezig = false;
      venster.removeAttribute('aria-busy');
    }
  }

  function luisterAan(aan: boolean) {
    mic.setAttribute('aria-pressed', String(aan));
    venster.classList.toggle('luistert', aan);
  }

  /** Opnemen tot je even stil bent (of hooguit acht seconden), dan naar de Whisper-server. */
  async function neemOp() {
    if (opname) {
      opname.stop();
      return;
    }
    let stroom: MediaStream;
    try {
      stroom = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      zeg('Atlas mag de microfoon niet gebruiken.', 'fout');
      return;
    }
    const rec = new MediaRecorder(stroom);
    const delen: Blob[] = [];
    rec.ondataavailable = (e) => delen.push(e.data);
    const ctx = new AudioContext();
    const meter = ctx.createAnalyser();
    meter.fftSize = 512;
    ctx.createMediaStreamSource(stroom).connect(meter);
    const golf = new Uint8Array(meter.fftSize);
    const begin = performance.now();
    let gesproken = false;
    let stilSinds = begin;
    const meet = () => {
      if (rec.state !== 'recording') return;
      meter.getByteTimeDomainData(golf);
      let som = 0;
      for (const w of golf) som += ((w - 128) / 128) ** 2;
      const nu = performance.now();
      if (Math.sqrt(som / golf.length) > 0.04) {
        gesproken = true;
        stilSinds = nu;
      }
      if ((gesproken && nu - stilSinds > 1200) || nu - begin > 8000 || (!gesproken && nu - begin > 5000)) rec.stop();
      else requestAnimationFrame(meet);
    };
    rec.onstop = async () => {
      stroom.getTracks().forEach((t) => t.stop());
      void ctx.close();
      opname = null;
      luisterAan(false);
      if (!gesproken) {
        zeg('Ik hoorde niets.', 'fout');
        return;
      }
      zeg('Even luisteren…', 'luistert');
      const blob = new Blob(delen, { type: rec.mimeType || 'audio/webm' });
      try {
        const a = await fetch('/api/spraak', { method: 'POST', headers: { 'content-type': blob.type.split(';')[0] }, body: blob });
        const d = (await a.json()) as { tekst?: string; fout?: string };
        if (!a.ok) throw new Error(d.fout ?? 'Spraak lukte niet');
        if (!d.tekst) {
          zeg('Ik verstond het niet.', 'fout');
          return;
        }
        veld.value = d.tekst;
        void verstuur(d.tekst, true);
      } catch (fout) {
        zeg(fout instanceof Error ? fout.message : 'Spraak lukte niet', 'fout');
      }
    };
    rec.start();
    opname = { stop: () => rec.state === 'recording' && rec.stop() };
    luisterAan(true);
    zeg('Ik luister…', 'luistert');
    requestAnimationFrame(meet);
  }

  function luister() {
    if (serverSpraak) {
      void neemOp();
      return;
    }
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
      luisterAan(false);
      if (klaar) void verstuur(klaar, true);
    };
    luistert = r;
    luisterAan(true);
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
  venster.addEventListener('close', () => {
    luistert?.stop();
    opname?.stop();
  });

  document.addEventListener('keydown', (e) => {
    const doel = e.target as HTMLElement;
    const inVeld = !!doel.closest('input, select, textarea, [contenteditable]');
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (venster.open) sluit();
      else open();
      e.preventDefault();
    } else if (e.code === 'Space' && e.ctrlKey && !e.altKey && !e.metaKey) {
      // Ctrl+Spatie: meteen spreken, ook als het venster nog dicht is. Nog een keer stopt het luisteren.
      open(true);
      e.preventDefault();
    } else if (e.key === '/' && !inVeld && !document.querySelector('dialog[open]')) {
      open();
      e.preventDefault();
    }
  });

  return { open };
}
