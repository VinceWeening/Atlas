// De indeling van Ewisweg 36 is nog een schatting op basis van de buurhuizen; die stellen we samen bij.
export type Lamp = { id: string; naam: string };
export type Ruimte = { id: string; naam: string; l: number; t: number; w: number; h: number; temp: string; lampen: Lamp[] };
export type Laag = { id: string; naam: string; label: string; hoogte: number; z: number; muur: number; ruimtes: Ruimte[] };

export const lagen: Laag[] = [
  {
    id: 'bg', naam: 'Begane grond', label: 'BEGANE GROND', hoogte: 100, z: 0, muur: 34,
    ruimtes: [
      { id: 'woon', naam: 'Woonkamer', l: 0, t: 0, w: 62, h: 70, temp: '20,5 °C', lampen: [{ id: 'woon', naam: 'Plafondlamp' }] },
      { id: 'hal', naam: 'Hal', l: 62, t: 0, w: 38, h: 30, temp: '', lampen: [] },
      { id: 'keuken', naam: 'Keuken', l: 62, t: 30, w: 38, h: 40, temp: '19,8 °C', lampen: [{ id: 'keuken', naam: 'Keuken spots' }] },
      { id: 'uitbouw', naam: 'Uitbouw', l: 0, t: 70, w: 100, h: 30, temp: '', lampen: [] },
    ],
  },
  {
    id: 'v1', naam: '1e verdieping', label: '1E VERDIEPING', hoogte: 70, z: 160, muur: 34,
    ruimtes: [
      { id: 'slpv', naam: 'Slaapkamer voor', l: 0, t: 0, w: 58, h: 46, temp: '', lampen: [] },
      { id: 'overloop', naam: 'Overloop', l: 58, t: 0, w: 42, h: 28, temp: '', lampen: [] },
      { id: 'bad', naam: 'Badkamer', l: 58, t: 28, w: 42, h: 30, temp: '', lampen: [] },
      { id: 'bureau', naam: 'Bureau Vince', l: 0, t: 46, w: 58, h: 54, temp: '21,0 °C', lampen: [{ id: 'bureau', naam: 'Bureau Vince' }] },
      { id: 'slpa', naam: 'Slaapkamer', l: 58, t: 58, w: 42, h: 42, temp: '', lampen: [] },
    ],
  },
  {
    id: 'zolder', naam: 'Zolder', label: 'ZOLDER', hoogte: 70, z: 320, muur: 18,
    ruimtes: [
      { id: 'czolder', naam: 'Centrale zolder', l: 0, t: 0, w: 100, h: 46, temp: '18,4 °C', lampen: [{ id: 'zolder', naam: 'Centrd.zolder Spots' }] },
      { id: 'zkamer', naam: 'Zolderkamer', l: 0, t: 46, w: 100, h: 54, temp: '', lampen: [] },
    ],
  },
];
