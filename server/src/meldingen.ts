// Meldingen uit Frigate. De server kijkt elke paar seconden of Frigate iets nieuws heeft gezien, filtert dat met de
// instellingen uit het tandwiel en stuurt het door: naar de telefoon via de Home Assistant-app, en naar de pc via
// /api/meldingen, dat de Windows-app en de pagina zelf ophalen.
import type { Toestel } from './ha.js';
import { instellingen } from './instellingen.js';

export type Melding = {
  /** Oplopend nummer, zodat een scherm kan vragen wat er sinds de vorige keer bij is gekomen. */
  volg: number;
  id: string;
  camera: string;
  soort: string;
  titel: string;
  tekst: string;
  tijd: string;
  beeld: string | null;
  /** Of de pc deze melding moet laten zien. */
  pc: boolean;
};

type Gebeurtenis = {
  id: string;
  camera: string;
  label: string;
  start_time: number;
  false_positive?: boolean | null;
};

type Telefoon = {
  toestellen(): Promise<Toestel[]>;
  melding(toestel: string, titel: string, tekst: string): Promise<void>;
};

const soortNamen: Record<string, string> = {
  person: 'Persoon',
  car: 'Auto',
  bicycle: 'Fiets',
  motorcycle: 'Motor',
  dog: 'Hond',
  cat: 'Kat',
  bird: 'Vogel',
  package: 'Pakket',
};

export const cameraNaam = (camera: string) => camera.replace(/_/g, ' ').replace(/^\w/, (l) => l.toUpperCase());
const uur = (tijd: Date) => tijd.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });

export class Meldingen {
  private lijst: Melding[] = [];
  private volg = 0;
  private gezien = new Set<string>();
  private laatsteStart = Date.now() / 1000;
  private stilTot = new Map<string, number>();
  private cameras: { tijd: number; lijst: string[] } | null = null;
  /** De eerste ronde na het opstarten alleen onthouden wat er al was, anders komt een herstart met oude meldingen. */
  private eersteRonde = true;
  bereikbaar = false;

  constructor(
    private readonly frigate: string | null,
    private readonly telefoon: Telefoon,
    private readonly log: { warn: (bericht: unknown) => void },
  ) {}

  static uitOmgeving(telefoon: Telefoon, log: { warn: (bericht: unknown) => void }) {
    const frigate = process.env.FRIGATE_URL?.trim().replace(/\/+$/, '') || null;
    const meldingen = new Meldingen(frigate, telefoon, log);
    if (frigate) {
      meldingen.kijk();
      setInterval(() => meldingen.kijk(), 5000);
    }
    return meldingen;
  }

  get ingesteld() {
    return !!this.frigate;
  }

  /** Meldingen na een bepaald volgnummer; zonder nummer de laatste tien. */
  sinds(na: number | null) {
    const meldingen = na == null ? this.lijst.slice(-10) : this.lijst.filter((m) => m.volg > na);
    return { laatste: this.volg, meldingen };
  }

  async frigateCameras(): Promise<string[]> {
    if (!this.frigate) return [];
    if (this.cameras && Date.now() - this.cameras.tijd < 5 * 60_000) return this.cameras.lijst;
    const antwoord = await fetch(`${this.frigate}/api/config`, { signal: AbortSignal.timeout(8000) });
    if (!antwoord.ok) throw new Error(`Frigate gaf ${antwoord.status}`);
    const config = (await antwoord.json()) as { cameras?: Record<string, unknown> };
    const lijst = Object.keys(config.cameras ?? {});
    this.cameras = { tijd: Date.now(), lijst };
    return lijst;
  }

  async beeld(id: string) {
    if (!this.frigate || !/^[\w.-]{1,80}$/.test(id)) return null;
    const antwoord = await fetch(`${this.frigate}/api/events/${id}/thumbnail.jpg`, { signal: AbortSignal.timeout(8000) });
    if (!antwoord.ok) return null;
    return { type: antwoord.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(await antwoord.arrayBuffer()) };
  }

  /** Een melding om te zien of pc en telefoon goed staan. Geeft terug wat er met de telefoon gebeurde. */
  async test() {
    const nu = new Date();
    return this.verstuur({ id: `test-${nu.getTime()}`, camera: 'test', soort: 'test', titel: 'Testmelding van Atlas', tekst: `Alles werkt · ${uur(nu)}`, tijd: nu.toISOString(), beeld: null }, true);
  }

  private async kijk() {
    try {
      const adres = `${this.frigate}/api/events?limit=50&after=${Math.floor(this.laatsteStart - 60)}`;
      const antwoord = await fetch(adres, { signal: AbortSignal.timeout(8000) });
      if (!antwoord.ok) throw new Error(`Frigate gaf ${antwoord.status}`);
      const nieuw = ((await antwoord.json()) as Gebeurtenis[]).filter((g) => !this.gezien.has(g.id)).sort((a, b) => a.start_time - b.start_time);
      this.bereikbaar = true;
      for (const g of nieuw) {
        this.gezien.add(g.id);
        this.laatsteStart = Math.max(this.laatsteStart, g.start_time);
        if (!g.false_positive && !this.eersteRonde) await this.gebeurtenis(g);
      }
      this.eersteRonde = false;
      // De lijst met geziene gebeurtenissen niet eindeloos laten groeien.
      if (this.gezien.size > 2000) this.gezien = new Set([...this.gezien].slice(-500));
    } catch (fout) {
      if (this.bereikbaar) this.log.warn(fout);
      this.bereikbaar = false;
    }
  }

  private async gebeurtenis(g: Gebeurtenis) {
    const inst = instellingen().meldingen;
    if (!inst.soorten.includes(g.label) || inst.camerasUit.includes(g.camera)) return;
    const nu = Date.now();
    if ((this.stilTot.get(g.camera) ?? 0) > nu) return;
    this.stilTot.set(g.camera, nu + inst.wachttijd * 60_000);
    const tijd = new Date(g.start_time * 1000);
    await this.verstuur({
      id: g.id,
      camera: g.camera,
      soort: g.label,
      titel: `${soortNamen[g.label] ?? cameraNaam(g.label)} bij ${cameraNaam(g.camera)}`,
      tekst: `Gezien om ${uur(tijd)}`,
      tijd: tijd.toISOString(),
      beeld: `/api/meldingen/${encodeURIComponent(g.id)}/beeld`,
    });
  }

  private async verstuur(m: Omit<Melding, 'volg' | 'pc'>, test = false) {
    const inst = instellingen().meldingen;
    this.lijst.push({ ...m, volg: ++this.volg, pc: inst.pc });
    if (this.lijst.length > 50) this.lijst.shift();
    if (!inst.telefoon || !inst.toestel) return test ? 'De telefoon staat uit in het tandwiel.' : null;
    try {
      await this.telefoon.melding(inst.toestel, m.titel, m.tekst);
      return test ? 'Ook naar je telefoon gestuurd.' : null;
    } catch (fout) {
      this.log.warn(fout);
      return 'Naar de telefoon sturen lukte niet. Klopt de gekozen telefoon nog?';
    }
  }
}
