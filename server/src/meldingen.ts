// Meldingen uit Frigate. De server kijkt elke paar seconden of Frigate iets nieuws heeft gezien, filtert dat met de
// instellingen uit het tandwiel en stuurt het door: naar de telefoon via de Home Assistant-app, en naar de pc via
// /api/meldingen, dat de Windows-app en de pagina zelf ophalen.
import type { Toestel } from './ha.js';
import { instellingen, nuIn } from './instellingen.js';
import { Dienst, controles } from './zoek.js';

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
  /** Binnengekomen tijdens de stille uren: niet gemeld, wel in de tijdlijn. */
  stil?: boolean;
};

type Gebeurtenis = {
  id: string;
  camera: string;
  label: string;
  start_time: number;
  end_time?: number | null;
  false_positive?: boolean | null;
  /** Zones waar het ding in is geweest. */
  zones?: string[];
  /** Naam uit de gezichtsherkenning (Frigate 0.16): een tekst, of [naam, zekerheid]. */
  sub_label?: string | [string, number] | null;
};

const naamVan = (g: Gebeurtenis) => (Array.isArray(g.sub_label) ? g.sub_label[0] : g.sub_label) || null;

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
  /** Gebeurtenissen die nog wachten op een gezicht of een zone, met wanneer Atlas ze voor het eerst zag. */
  private wacht = new Map<string, { gezien: number; start: number }>();
  bereikbaar = false;

  constructor(
    readonly frigate: Dienst,
    private readonly telefoon: Telefoon,
    private readonly log: { warn: (bericht: unknown) => void },
  ) {}

  static uitOmgeving(telefoon: Telefoon, log: { info: (bericht: string) => void; warn: (bericht: unknown) => void }) {
    const meldingen = new Meldingen(new Dienst('Frigate', 'frigate', 5000, controles.frigate, log), telefoon, log);
    meldingen.kijk();
    setInterval(() => meldingen.kijk(), 5000);
    return meldingen;
  }

  get ingesteld() {
    return !!this.frigate.adres;
  }

  /** Meldingen na een bepaald volgnummer; zonder nummer de laatste tien. */
  sinds(na: number | null) {
    const meldingen = na == null ? this.lijst.slice(-10) : this.lijst.filter((m) => m.volg > na);
    return { laatste: this.volg, meldingen };
  }

  /** De laatste opnames van wat er in Meldingen › Waarvoor aan staat (standaard personen), nieuwste eerst. */
  async opnames() {
    if (!this.frigate.adres) return [];
    const soorten = instellingen().meldingen.soorten.join(',') || 'person';
    const lijst = (await (
      await fetch(`${this.frigate.adres}/api/events?limit=24&has_clip=1&labels=${encodeURIComponent(soorten)}`, { signal: AbortSignal.timeout(8000) })
    ).json()) as Gebeurtenis[];
    return lijst
      .filter((g) => !g.false_positive)
      .map((g) => ({
        id: g.id,
        camera: cameraNaam(g.camera),
        titel: naamVan(g) ?? soortNamen[g.label] ?? cameraNaam(g.label),
        tijd: new Date(g.start_time * 1000).toISOString(),
        duur: g.end_time ? Math.round(g.end_time - g.start_time) : null,
        beeld: `/api/meldingen/${encodeURIComponent(g.id)}/beeld`,
        video: `/api/meldingen/${encodeURIComponent(g.id)}/video`,
      }));
  }

  /**
   * Tijdlijn van vandaag: alles wat Frigate sinds middernacht zag van de soorten in Meldingen › Waarvoor, nieuwste eerst.
   * Ook wat tijdens de stille uren of de stilte na een melding binnenkwam, zodat je 's ochtends ziet wie er was.
   */
  async vandaag() {
    if (!this.frigate.adres) return null;
    const inst = instellingen().meldingen;
    const middernacht = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }) + 'T00:00:00');
    const soorten = inst.soorten.join(',') || 'person';
    const antwoord = await fetch(
      `${this.frigate.adres}/api/events?limit=60&after=${Math.floor(middernacht.getTime() / 1000)}&labels=${encodeURIComponent(soorten)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!antwoord.ok) throw new Error(`Frigate gaf ${antwoord.status}`);
    const lijst = (await antwoord.json()) as Gebeurtenis[];
    const gemeld = new Set(this.lijst.filter((m) => !m.stil).map((m) => m.id));
    return lijst
      .filter((g) => !g.false_positive && !inst.camerasUit.includes(g.camera))
      .sort((a, b) => b.start_time - a.start_time)
      .map((g) => ({
        id: g.id,
        camera: cameraNaam(g.camera),
        titel: naamVan(g) ?? soortNamen[g.label] ?? cameraNaam(g.label),
        tijd: new Date(g.start_time * 1000).toISOString(),
        beeld: `/api/meldingen/${encodeURIComponent(g.id)}/beeld`,
        gemeld: gemeld.has(g.id),
      }));
  }

  /** De opname van een gebeurtenis; een Range-kop gaat mee zodat de video kan spoelen. */
  async video(id: string, bereik?: string) {
    if (!this.frigate.adres || !/^[\w.-]{1,80}$/.test(id)) return null;
    const antwoord = await fetch(`${this.frigate.adres}/api/events/${id}/clip.mp4`, { headers: bereik ? { range: bereik } : {}, signal: AbortSignal.timeout(30_000) });
    if (!antwoord.ok || !antwoord.body) return null;
    return antwoord;
  }

  /** Zones per camera en de namen uit de gezichtsherkenning, voor het tandwiel. */
  async frigateDetails(): Promise<{ zones: string[]; gezichten: string[] }> {
    if (!this.frigate.adres) return { zones: [], gezichten: [] };
    const config = (await (await fetch(`${this.frigate.adres}/api/config`, { signal: AbortSignal.timeout(8000) })).json()) as {
      cameras?: Record<string, { zones?: Record<string, unknown> }>;
    };
    const zones = Object.entries(config.cameras ?? {}).flatMap(([camera, c]) => Object.keys(c.zones ?? {}).map((z) => `${camera}/${z}`));
    // De gezichtenbibliotheek bestaat pas vanaf Frigate 0.16; bij een oudere versie blijft de lijst leeg.
    const gezichten = await fetch(`${this.frigate.adres}/api/faces`, { signal: AbortSignal.timeout(8000) })
      .then((a) => (a.ok ? (a.json() as Promise<Record<string, unknown>>) : {}))
      .then((f) => Object.keys(f).filter((n) => n !== 'train'))
      .catch(() => [] as string[]);
    return { zones, gezichten };
  }

  async frigateCameras(): Promise<string[]> {
    if (!this.frigate.adres) return [];
    if (this.cameras && Date.now() - this.cameras.tijd < 5 * 60_000) return this.cameras.lijst;
    const antwoord = await fetch(`${this.frigate.adres}/api/config`, { signal: AbortSignal.timeout(8000) });
    if (!antwoord.ok) throw new Error(`Frigate gaf ${antwoord.status}`);
    const config = (await antwoord.json()) as { cameras?: Record<string, unknown> };
    const lijst = Object.keys(config.cameras ?? {});
    this.cameras = { tijd: Date.now(), lijst };
    return lijst;
  }

  async beeld(id: string) {
    if (!this.frigate.adres || !/^[\w.-]{1,80}$/.test(id)) return null;
    const antwoord = await fetch(`${this.frigate.adres}/api/events/${id}/thumbnail.jpg`, { signal: AbortSignal.timeout(8000) });
    if (!antwoord.ok) return null;
    return { type: antwoord.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(await antwoord.arrayBuffer()) };
  }

  /** Een melding om te zien of pc en telefoon goed staan. Geeft terug wat er met de telefoon gebeurde. */
  async test() {
    const nu = new Date();
    // Zo echt mogelijk: een persoon bij de voordeur, met het huidige beeld van die camera als Frigate er is.
    const cameras = await this.frigateCameras().catch(() => [] as string[]);
    const camera = cameras.find((c) => /voor|deur|bel|door/i.test(c)) ?? cameras[0] ?? null;
    return this.verstuur(
      {
        id: `test-${nu.getTime()}`,
        camera: camera ?? 'voordeur',
        soort: 'person',
        titel: `Persoon bij ${cameraNaam(camera ?? 'voordeur')}`,
        tekst: `Testmelding · ${uur(nu)}`,
        tijd: nu.toISOString(),
        beeld: camera ? `/api/meldingen/camera/${encodeURIComponent(camera)}/beeld` : null,
      },
      true,
    );
  }

  /** Het huidige beeld van een Frigate-camera. */
  async cameraBeeld(camera: string) {
    if (!this.frigate.adres || !/^[\w-]{1,64}$/.test(camera)) return null;
    const antwoord = await fetch(`${this.frigate.adres}/api/${camera}/latest.jpg?h=480`, { signal: AbortSignal.timeout(8000) });
    if (!antwoord.ok) return null;
    return { type: antwoord.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(await antwoord.arrayBuffer()) };
  }

  private async kijk() {
    const frigate = await this.frigate.vind();
    if (!frigate) return;
    try {
      // Ook gebeurtenissen die nog wachten op een gezicht of een zone blijven in beeld.
      const vanaf = Math.min(this.laatsteStart, ...[...this.wacht.values()].map((w) => w.start)) - 60;
      const antwoord = await fetch(`${frigate}/api/events?limit=50&after=${Math.floor(vanaf)}`, { signal: AbortSignal.timeout(8000) });
      if (!antwoord.ok) throw new Error(`Frigate gaf ${antwoord.status}`);
      const nieuw = ((await antwoord.json()) as Gebeurtenis[]).filter((g) => !this.gezien.has(g.id)).sort((a, b) => a.start_time - b.start_time);
      this.bereikbaar = true;
      for (const g of nieuw) {
        this.laatsteStart = Math.max(this.laatsteStart, g.start_time);
        if (this.eersteRonde || g.false_positive) this.klaar(g.id);
        else await this.gebeurtenis(g);
      }
      this.eersteRonde = false;
      // De lijst met geziene gebeurtenissen niet eindeloos laten groeien.
      if (this.gezien.size > 2000) this.gezien = new Set([...this.gezien].slice(-500));
    } catch (fout) {
      if (this.bereikbaar) this.log.warn(fout);
      this.bereikbaar = false;
    }
  }

  private klaar(id: string) {
    this.gezien.add(id);
    this.wacht.delete(id);
  }

  /**
   * Beslist per gebeurtenis: melden, overslaan, of nog even wachten. Wachten gebeurt als de gezichtsherkenning nog bezig
   * kan zijn (een paar seconden) of als de camera zones heeft gekozen en het ding daar nog niet in is geweest.
   */
  private async gebeurtenis(g: Gebeurtenis) {
    const inst = instellingen().meldingen;
    if (!inst.soorten.includes(g.label) || inst.camerasUit.includes(g.camera)) return this.klaar(g.id);
    const eerst = this.wacht.get(g.id)?.gezien ?? Date.now();
    if (!this.wacht.has(g.id)) this.wacht.set(g.id, { gezien: eerst, start: g.start_time });
    const leeftijd = Date.now() - eerst;
    const afgelopen = !!g.end_time;

    const zones = inst.zones.filter((z) => z.startsWith(`${g.camera}/`)).map((z) => z.slice(g.camera.length + 1));
    const inZone = zones.length ? (g.zones ?? []).find((z) => zones.includes(z)) : undefined;
    if (zones.length && !inZone) {
      if (afgelopen || leeftijd > 120_000) this.klaar(g.id);
      return;
    }

    const naam = naamVan(g);
    if (!naam && g.label === 'person' && !afgelopen && leeftijd < 6_000) return;
    if (naam && inst.bekenden.some((b) => b.toLowerCase() === naam.toLowerCase())) return this.klaar(g.id);

    this.klaar(g.id);
    const nu = Date.now();
    if ((this.stilTot.get(g.camera) ?? 0) > nu) return;
    this.stilTot.set(g.camera, nu + inst.wachttijd * 60_000);
    const tijd = new Date(g.start_time * 1000);
    await this.verstuur({
      id: g.id,
      camera: g.camera,
      soort: g.label,
      titel: `${naam ?? soortNamen[g.label] ?? cameraNaam(g.label)} bij ${cameraNaam(g.camera)}`,
      tekst: `Gezien om ${uur(tijd)}${inZone ? ` · ${cameraNaam(inZone)}` : ''}`,
      tijd: tijd.toISOString(),
      beeld: `/api/meldingen/${encodeURIComponent(g.id)}/beeld`,
    });
  }

  private async verstuur(m: Omit<Melding, 'volg' | 'pc'>, test = false) {
    const inst = instellingen().meldingen;
    // Tijdens de stille uren alleen onthouden; een testmelding gaat altijd door.
    const stil = !test && nuIn(inst.stil);
    this.lijst.push({ ...m, volg: ++this.volg, pc: inst.pc && !stil, stil });
    if (this.lijst.length > 50) this.lijst.shift();
    if (stil) return null;
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
