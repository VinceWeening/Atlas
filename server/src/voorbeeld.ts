import type { Apparaat, Apparaten, Huis } from './ha.js';

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

const lamp = (id: string, naam: string, aan: boolean) => ({ id, naam, aan, helderheid: aan ? 80 : null, bereikbaar: true });

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

  async toestellen() {
    return [];
  }

  async melding(_toestel: string, _titel: string, _tekst: string) {}

  async bestaat(entiteit: string) {
    return this.alleLampen().some((l) => l.id === entiteit) || this.staat.scenes.some((s) => s.id === entiteit);
  }

  async lamp(entiteit: string, aan: boolean) {
    const gevonden = this.alleLampen().find((l) => l.id === entiteit);
    if (gevonden) gevonden.aan = aan;
  }

  async scene(_entiteit: string) {}

  async apparaten(): Promise<Apparaten> {
    const alsApparaat = (l: { id: string; naam: string; aan: boolean; helderheid: number | null }): Apparaat => ({
      id: l.id,
      naam: l.naam,
      soort: 'light',
      tekst: l.aan ? `Aan · ${l.helderheid ?? 100}%` : 'Uit',
      aan: l.aan,
      bediening: 'schakel',
      bereikbaar: true,
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
    await this.lamp(entiteit, aan);
  }

  async cameraBeeld(_entiteit: string): Promise<{ type: string; data: Buffer } | null> {
    return null;
  }

  private alleLampen() {
    return [...this.staat.kamers.flatMap((k) => k.lampen), ...this.staat.losseLampen];
  }
}
