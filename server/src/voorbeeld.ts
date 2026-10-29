import type { Huis } from './ha.js';

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
    { van: 'Bol.com', onderwerp: 'Pakket komt morgen' },
    { van: 'Gemeente', onderwerp: 'Afvalkalender 2027' },
    { van: 'Jellyfin', onderwerp: 'Nieuwe film' },
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

  async cameraBeeld(_entiteit: string): Promise<{ type: string; data: Buffer } | null> {
    return null;
  }

  private alleLampen() {
    return [...this.staat.kamers.flatMap((k) => k.lampen), ...this.staat.losseLampen];
  }
}
