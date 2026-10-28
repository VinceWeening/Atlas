import './styles.css';
import { lagen, type Ruimte } from './huis';

type Overzicht = {
  voorbeeld: boolean;
  weer: { omschrijving: string; temperatuur: number; vanavond: number };
  agenda: { tijd: string; titel: string; detail: string }[];
  morgen: string;
  mail: { van: string; onderwerp: string }[];
  voordeur: { laatsteBeweging: string };
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Toestand van het scherm. Lampen schakelen nu alleen hier; in fase 2 gaat dit via Home Assistant.
const staat = {
  verdieping: 'alle',
  modus: '3d' as '2d' | '3d',
  gekozen: 'bureau',
  aan: { woon: true, keuken: false, bureau: true, zolder: false } as Record<string, boolean>,
};

function tekst(el: HTMLElement, waarde: string) {
  el.textContent = waarde;
}

function maak<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, inhoud?: string) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (inhoud !== undefined) el.textContent = inhoud;
  return el;
}

// Klok en dagboog
const datumFormaat = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' });
function tikKlok() {
  const nu = new Date();
  tekst($('tijd'), nu.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }));
  tekst($('datum'), datumFormaat.format(nu));
  const deel = (nu.getHours() * 60 + nu.getMinutes()) / 1440;
  $('dagboog').setAttribute('stroke-dasharray', `${Math.round(503 * deel)} 503`);
}

// Huis
function alleRuimtes(): (Ruimte & { laag: string })[] {
  return lagen.flatMap((l) => l.ruimtes.map((r) => ({ ...r, laag: l.naam })));
}
const isAan = (r: Ruimte) => r.lampen.some((l) => staat.aan[l.id]);

function tekenHuis() {
  const huis = $('huis');
  const driedee = staat.modus === '3d';
  const getoond = !driedee && staat.verdieping === 'alle' ? 'bg' : staat.verdieping;
  const gestapeld = getoond === 'alle';

  const gebouw = maak('div', 'gebouw' + (driedee ? '' : ' plat'));
  gebouw.style.transform = !driedee
    ? 'scale(0.92)'
    : gestapeld
      ? 'translateY(110px) rotateX(60deg) rotateZ(-38deg) scale(0.78)'
      : 'translateY(40px) rotateX(55deg) rotateZ(-38deg) scale(0.95)';

  for (const laag of lagen) {
    if (!gestapeld && getoond !== laag.id) continue;
    const vlak = maak('div', 'laag');
    vlak.style.height = `${laag.hoogte}%`;
    vlak.style.transform = `translateZ(${gestapeld ? laag.z : 0}px)`;
    vlak.style.boxShadow = gestapeld
      ? '0 0 0 2px #C7CED8, 0 50px 80px -20px rgba(0,0,0,0.7)'
      : '0 0 0 4px #C7CED8, 0 60px 90px -10px rgba(0,0,0,0.85)';
    const naam = maak('span', 'lbl laag-naam', laag.label);
    if (staat.verdieping === laag.id) naam.style.color = '#D6EDFF';
    vlak.append(naam);

    for (const r of laag.ruimtes) {
      const knop = maak('button', 'ruimte' + (isAan(r) ? ' licht' : ''));
      knop.type = 'button';
      Object.assign(knop.style, { left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%` });
      knop.setAttribute('aria-pressed', String(r.id === staat.gekozen));
      knop.setAttribute('aria-label', `${laag.naam}, ${r.naam}${isAan(r) ? ', licht aan' : ''}`);
      const label = maak('span');
      label.style.cssText = 'display:flex;flex-direction:column;gap:2px';
      label.append(maak('span', 'naam', r.naam), maak('span', 'temp', r.temp));
      knop.append(label);
      if (driedee) {
        const m = laag.muur;
        const muren: [string, string][] = [
          [`left:0;top:0;width:100%;height:${m}px`, 'top'],
          [`left:0;top:100%;width:100%;height:${m}px`, 'top'],
          [`left:0;top:0;width:${m}px;height:100%`, 'left'],
          [`left:100%;top:0;width:${m}px;height:100%`, 'left'],
        ];
        for (const [plek, as] of muren) {
          const muur = maak('span', 'muur');
          muur.setAttribute('aria-hidden', 'true');
          muur.style.cssText = `${plek};transform-origin:${as};transform:${as === 'top' ? 'rotateX(-90deg)' : 'rotateY(-90deg)'}`;
          knop.append(muur);
        }
      }
      knop.addEventListener('click', () => {
        staat.gekozen = r.id;
        tekenAlles();
      });
      vlak.append(knop);
    }
    gebouw.append(vlak);
  }
  huis.replaceChildren(gebouw);
}

function tekenKnoppen() {
  const opties = [{ id: 'alle', naam: 'Alles' }, ...lagen.map((l) => ({ id: l.id, naam: l.id === 'v1' ? '1e' : l.naam }))];
  $('verdiepingen').replaceChildren(
    ...opties.map((o) => {
      const knop = maak('button', undefined, o.naam);
      knop.type = 'button';
      knop.setAttribute('aria-pressed', String(staat.verdieping === o.id));
      knop.addEventListener('click', () => {
        staat.verdieping = o.id;
        tekenAlles();
      });
      return knop;
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((knop) => {
    knop.setAttribute('aria-pressed', String(knop.dataset.modus === staat.modus));
  });
}

function tekenKamer() {
  const ruimte = alleRuimtes().find((r) => r.id === staat.gekozen) ?? alleRuimtes()[0];
  tekst($('kamer-label'), `KAMER · ${ruimte.laag.toUpperCase()}`);
  tekst($('kamer-naam'), ruimte.naam);
  tekst($('kamer-temp'), ruimte.temp);
  const lijst = $('lampen');
  if (ruimte.lampen.length === 0) {
    lijst.replaceChildren(maak('p', 'muted', 'Hier zijn nog geen lampen gekoppeld.'));
    return;
  }
  lijst.replaceChildren(
    ...ruimte.lampen.map((lamp) => {
      const aan = !!staat.aan[lamp.id];
      const rij = maak('div', 'lamp');
      const info = maak('div', 'lamp-info');
      const namen = maak('span');
      namen.append(lamp.naam, maak('small', undefined, aan ? 'Aan' : 'Uit'));
      info.append(namen);
      const schakelaar = maak('button', 'schakelaar');
      schakelaar.type = 'button';
      schakelaar.setAttribute('role', 'switch');
      schakelaar.setAttribute('aria-checked', String(aan));
      schakelaar.setAttribute('aria-label', `${lamp.naam} ${aan ? 'uitzetten' : 'aanzetten'}`);
      schakelaar.addEventListener('click', () => {
        staat.aan[lamp.id] = !aan;
        tekenAlles();
      });
      rij.append(info, schakelaar);
      return rij;
    }),
  );
}

function tekenHud() {
  const aan = Object.values(staat.aan).filter(Boolean).length;
  const totaal = Object.keys(staat.aan).length;
  const hud = $('hud');
  hud.replaceChildren(
    maak('span', undefined, 'BINNEN 20,5 °C'),
    maak('span', 'warm', `LAMPEN ${aan} / ${totaal} AAN`),
    maak('span', undefined, `VOORDEUR ${$('beweging').dataset.tijd ?? '--:--'}`),
  );
}

function tekenAlles() {
  tekenKnoppen();
  tekenHuis();
  tekenKamer();
  tekenHud();
}

function tekenOverzicht(o: Overzicht) {
  tekst($('weer'), `${o.weer.temperatuur} °C ${o.weer.omschrijving.toLowerCase()}`);
  tekst($('aantal-afspraken'), `${o.agenda.length} afspraken`);
  $('agenda').replaceChildren(
    ...o.agenda.map((a) => {
      const rij = maak('div', 'afspraak');
      const blok = maak('div');
      blok.append(maak('strong', undefined, a.titel), maak('span', 'muted klein', a.detail));
      rij.append(maak('span', 'mono', a.tijd), blok);
      return rij;
    }),
  );
  tekst($('morgen'), `Morgen ${o.morgen}`);
  tekst($('mail-aantal'), `${o.mail.length} ongelezen`);
  $('mail').replaceChildren(
    ...o.mail.map((m) => {
      const rij = maak('div', 'mailregel');
      rij.append(maak('strong', undefined, m.van), maak('span', 'muted', m.onderwerp));
      return rij;
    }),
  );
  const beweging = $('beweging');
  beweging.dataset.tijd = o.voordeur.laatsteBeweging;
  tekst(beweging, `Beweging om ${o.voordeur.laatsteBeweging}`);
  $('voorbeeld').hidden = !o.voorbeeld;
  tekenHud();
}

async function laadOverzicht() {
  try {
    const antwoord = await fetch('/api/overzicht');
    if (!antwoord.ok) throw new Error(`Server gaf ${antwoord.status}`);
    tekenOverzicht(await antwoord.json());
  } catch (fout) {
    console.error('Overzicht laden mislukt', fout);
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-modus]').forEach((knop) => {
  knop.addEventListener('click', () => {
    staat.modus = knop.dataset.modus as '2d' | '3d';
    tekenAlles();
  });
});

tikKlok();
setInterval(tikKlok, 1000);
tekenAlles();
laadOverzicht();
setInterval(laadOverzicht, 60_000);
