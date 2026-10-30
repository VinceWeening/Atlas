import type { Energie } from './energie.js';
import type { Apparaat, Apparaten, CameraOptie, Huis, Lamp } from './ha.js';

// Voorbeeldgegevens. Agenda en mail blijven voorbeeld tot de Google-koppeling er is;
// het huis gebruikt dit alleen als er geen Home Assistant is ingesteld.
export const voorbeeld = {
  weer: { omschrijving: 'Helder', temperatuur: 13 },
  agenda: [
    { tijd: '17:30', titel: 'Sporten', detail: 'tot 18:30' },
    { tijd: '19:00', titel: 'Eten bij ouders', detail: 'vertrek 18:40' },
  ],
  morgen: '09:00 · Overleg',
  mail: [
    { van: 'Bol.com', onderwerp: 'Pakket komt morgen', stukje: 'Je bestelling wordt morgen tussen 14:00 en 17:00 bezorgd.', tijd: null },
    { van: 'Gemeente Heiloo', onderwerp: 'Afvalkalender 2027', stukje: 'De nieuwe afvalkalender staat klaar in de app.', tijd: null },
    { van: 'Jellyfin', onderwerp: 'Nieuwe film', stukje: 'Er is een nieuwe film toegevoegd aan je bibliotheek.', tijd: null },
  ],
};

const lamp = (id: string, naam: string, aan: boolean): Lamp => ({
  id,
  naam,
  aan,
  helderheid: aan ? 80 : null,
  dimbaar: true,
  kleurtemp: { min: 2200, max: 6500, nu: 2700 },
  bereikbaar: true,
});

export class VoorbeeldHuis {
  private staat: Huis = {
    bron: 'voorbeeld',
    kamers: [
      { id: 'woonkamer', naam: 'Woonkamer', verdieping: 'Begane grond', temperatuur: 20.5, lampen: [lamp('light.woonkamer', 'Plafondlamp', true)] },
      { id: 'keuken', naam: 'Keuken', verdieping: 'Begane grond', temperatuur: 19.8, lampen: [lamp('light.keuken', 'Keuken spots', false)] },
      { id: 'bureau', naam: 'Bureau Vince', verdieping: '1e verdieping', temperatuur: 21, lampen: [lamp('light.bureau', 'Bureau Vince', true)] },
      { id: 'zolder', naam: 'Centrale zolder', verdieping: 'Zolder', temperatuur: 18.4, lampen: [lamp('light.zolder', 'Centrd.zolder Spots', false)] },
    ],
    losseLampen: [],
    cameras: [{ id: 'camera.voordeur', naam: 'Voordeur', kamer: null, beweging: null }],
    scenes: [
      { id: 'scene.filmavond', naam: 'Filmavond' },
      { id: 'scene.werken', naam: 'Werken' },
      { id: 'scene.slapen', naam: 'Slapen' },
    ],
    weer: null,
    binnen: 20,
  };

  async huis() {
    return this.staat;
  }

  async energie(): Promise<Energie> {
    // Een gewone dag: 's ochtends en 's avonds meer verbruik, rond het middaguur zon op het dak.
    const nu = new Date();
    const uur = nu.getHours() + nu.getMinutes() / 60;
    const zon = Math.max(0, Math.sin(((uur - 8) / 10) * Math.PI)) * 1400;
    const lampen = this.alleLampen().filter((l) => l.aan).length * 12;
    return {
      bron: 'voorbeeld',
      vermogen: Math.round(260 + lampen + (uur > 17 && uur < 20 ? 900 : 0) - zon),
      vandaag: { stroom: Math.round(uur * 0.31 * 100) / 100, terug: Math.round(Math.max(0, uur - 11) * 0.42 * 100) / 100, gas: Math.round(uur * 0.08 * 100) / 100, opwek: Math.round(Math.max(0, Math.min(uur, 18) - 8) * 0.55 * 100) / 100 },
      thermostaat: { id: 'climate.woonkamer', naam: 'Thermostaat', huidig: 20.5, doel: 20.5, stand: 'Rust' },
      kamers: this.staat.kamers.map((k, i) => ({ id: k.id, naam: k.naam, temperatuur: k.temperatuur, vocht: [52, 61, 48, 55][i % 4] })),
    };
  }

  /** In het voorbeeldhuis: GFT morgen en papier volgende week, zodat je ziet hoe het eruitziet. */
  async afval() {
    const dag = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
    return [
      { id: 'sensor.afvalwijzer_gft', naam: 'GFT', datum: dag(1) },
      { id: 'sensor.afvalwijzer_papier', naam: 'Papier', datum: dag(6) },
    ];
  }

  async toestellen() {
    return [];
  }

  async melding(_toestel: string, _titel: string, _tekst: string) {}

  async bestaat(entiteit: string) {
    return this.alleLampen().some((l) => l.id === entiteit) || this.staat.scenes.some((s) => s.id === entiteit);
  }

  async lamp(entiteit: string, opdracht: { aan?: boolean; helderheid?: number; kelvin?: number }) {
    const gevonden = this.alleLampen().find((l) => l.id === entiteit);
    if (!gevonden) return;
    gevonden.aan = opdracht.aan ?? true;
    if (opdracht.helderheid != null) gevonden.helderheid = opdracht.helderheid;
    if (opdracht.kelvin != null && gevonden.kleurtemp) gevonden.kleurtemp.nu = opdracht.kelvin;
  }

  async cameraOpties(_camera: string): Promise<CameraOptie[]> {
    return [];
  }

  async cameraOptie(_optie: CameraOptie, _waarde: unknown) {}

  async scene(_entiteit: string) {}

  async apparaten(): Promise<Apparaten> {
    const alsApparaat = (l: Lamp): Apparaat => ({
      id: l.id,
      naam: l.naam,
      soort: 'light',
      tekst: l.aan ? `Aan · ${l.helderheid ?? 100}%` : 'Uit',
      aan: l.aan,
      bediening: 'schakel',
      bereikbaar: true,
      lamp: { helderheid: l.helderheid, dimbaar: l.dimbaar, kleurtemp: l.kleurtemp },
    });
    const sensor = (id: string, naam: string, tekst: string): Apparaat => ({ id, naam, soort: 'sensor', tekst, aan: null, bediening: null, bereikbaar: true });
    return {
      ruimtes: this.staat.kamers.map((k) => ({
        id: k.id,
        naam: k.naam,
        verdieping: k.verdieping,
        apparaten: [
          ...k.lampen.map(alsApparaat),
          ...(k.temperatuur != null ? [sensor(`sensor.${k.id}_temperatuur`, 'Temperatuur', `${k.temperatuur.toLocaleString('nl-NL')} °C`)] : []),
        ],
      })),
      overig: this.staat.scenes.map((s) => ({ id: s.id, naam: s.naam, soort: 'scene', tekst: '', aan: null, bediening: 'start', bereikbaar: true })),
    };
  }

  async bedien(entiteit: string, aan: boolean) {
    await this.lamp(entiteit, { aan });
  }

  async cameraBeeld(_entiteit: string): Promise<{ type: string; data: Buffer } | null> {
    return null;
  }

  private alleLampen() {
    return [...this.staat.kamers.flatMap((k) => k.lampen), ...this.staat.losseLampen];
  }
}
