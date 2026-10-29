// Koppeling met Home Assistant via de REST-API. Atlas vraagt zelf op welke ruimtes, lampen, camera's en scènes er zijn,
// dus er hoeft niets per lamp ingesteld te worden.

export type Lamp = { id: string; naam: string; aan: boolean; helderheid: number | null; bereikbaar: boolean };
export type Kamer = { id: string; naam: string; verdieping: string | null; temperatuur: number | null; lampen: Lamp[] };
export type Camera = { id: string; naam: string; kamer: string | null; beweging: string | null };
export type Scene = { id: string; naam: string };
export type Toestel = { id: string; naam: string };
export type Huis = {
  bron: 'home-assistant' | 'voorbeeld';
  kamers: Kamer[];
  /** Lampen die in Home Assistant aan geen ruimte hangen. */
  losseLampen: Lamp[];
  cameras: Camera[];
  scenes: Scene[];
  weer: { omschrijving: string; temperatuur: number | null } | null;
  binnen: number | null;
};

type Toestand = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & { friendly_name?: string };
  last_changed: string;
};
type Ruimte = { id: string; naam: string; verdieping: string | null; entiteiten: string[] };

export type HaInstellingen = { url: string; token: string; voordeur?: string };

export function haInstellingen(): HaInstellingen | null {
  const url = process.env.HA_URL?.trim().replace(/\/+$/, '');
  const token = process.env.HA_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token, voordeur: process.env.HA_VOORDEUR?.trim() || undefined };
}

// Ruimtes en verdiepingen komen uit het register van Home Assistant. Dat kan alleen via een sjabloon,
// omdat de REST-API geen eigen adres voor ruimtes heeft.
const ruimteSjabloon = `{% set ns = namespace(r=[]) %}{% for a in areas() %}{% set e = namespace(l=area_entities(a)) %}{% for d in area_devices(a) %}{% set e.l = e.l + device_entities(d) %}{% endfor %}{% set ns.r = ns.r + [{'id': a, 'naam': area_name(a), 'verdieping': (floor_name(floor_id(a)) if floor_id is defined and floor_id(a) else none), 'entiteiten': e.l | unique | list}] %}{% endfor %}{{ ns.r | tojson }}`;

const weerNamen: Record<string, string> = {
  'clear-night': 'Helder',
  cloudy: 'Bewolkt',
  exceptional: 'Uitzonderlijk',
  fog: 'Mist',
  hail: 'Hagel',
  lightning: 'Onweer',
  'lightning-rainy': 'Onweer en regen',
  partlycloudy: 'Half bewolkt',
  pouring: 'Zware regen',
  rainy: 'Regen',
  snowy: 'Sneeuw',
  'snowy-rainy': 'Natte sneeuw',
  sunny: 'Zonnig',
  windy: 'Winderig',
  'windy-variant': 'Winderig en bewolkt',
};

export class HomeAssistant {
  private ruimtes: { tijd: number; lijst: Ruimte[] } | null = null;

  constructor(private readonly instellingen: HaInstellingen) {}

  private async vraag(pad: string, init: RequestInit = {}) {
    const antwoord = await fetch(`${this.instellingen.url}${pad}`, {
      ...init,
      headers: { authorization: `Bearer ${this.instellingen.token}`, 'content-type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(8000),
    });
    if (!antwoord.ok) throw new Error(`Home Assistant gaf ${antwoord.status} op ${pad}`);
    return antwoord;
  }

  private async haalRuimtes(): Promise<Ruimte[]> {
    // Het register verandert zelden, dus vijf minuten bewaren scheelt Home Assistant werk.
    if (this.ruimtes && Date.now() - this.ruimtes.tijd < 5 * 60_000) return this.ruimtes.lijst;
    const antwoord = await this.vraag('/api/template', { method: 'POST', body: JSON.stringify({ template: ruimteSjabloon }) });
    const lijst = JSON.parse(await antwoord.text()) as Ruimte[];
    this.ruimtes = { tijd: Date.now(), lijst };
    return lijst;
  }

  async huis(): Promise<Huis> {
    const [toestanden, ruimtes] = await Promise.all([
      this.vraag('/api/states').then((a) => a.json() as Promise<Toestand[]>),
      // Lukt het sjabloon niet (bijvoorbeeld een oude Home Assistant), dan komen alle lampen onder "Overige lampen".
      this.haalRuimtes().catch((fout) => {
        console.warn('Ruimtes ophalen mislukt', fout);
        return [] as Ruimte[];
      }),
    ]);
    const perId = new Map(toestanden.map((t) => [t.entity_id, t]));
    const naam = (t: Toestand) => t.attributes.friendly_name ?? t.entity_id;
    const kamerVan = new Map<string, string>();
    for (const r of ruimtes) for (const e of r.entiteiten) kamerVan.set(e, r.id);

    const alsLamp = (t: Toestand): Lamp => ({
      id: t.entity_id,
      naam: naam(t),
      aan: t.state === 'on',
      helderheid: typeof t.attributes.brightness === 'number' ? Math.round((t.attributes.brightness / 255) * 100) : null,
      bereikbaar: t.state !== 'unavailable',
    });
    const isTemperatuur = (t: Toestand) =>
      t.entity_id.startsWith('sensor.') && t.attributes.device_class === 'temperature' && Number.isFinite(Number(t.state));

    const kamers: Kamer[] = ruimtes.map((r) => {
      const eigen = r.entiteiten.map((e) => perId.get(e)).filter((t): t is Toestand => !!t);
      const temp = eigen.find(isTemperatuur);
      return {
        id: r.id,
        naam: r.naam,
        verdieping: r.verdieping,
        temperatuur: temp ? Number(temp.state) : null,
        lampen: eigen.filter((t) => t.entity_id.startsWith('light.')).map(alsLamp),
      };
    });

    const losseLampen = toestanden.filter((t) => t.entity_id.startsWith('light.') && !kamerVan.has(t.entity_id)).map(alsLamp);

    // Bij een camera hoort de laatste beweging van een bewegingssensor in dezelfde ruimte.
    const bewegingIn = (kamer: string | undefined) => {
      if (!kamer) return null;
      const sensoren = toestanden.filter(
        (t) =>
          t.entity_id.startsWith('binary_sensor.') &&
          kamerVan.get(t.entity_id) === kamer &&
          ['motion', 'occupancy', 'presence'].includes(String(t.attributes.device_class)),
      );
      const laatste = sensoren.map((t) => t.last_changed).sort().at(-1);
      return laatste ?? null;
    };
    const cameras: Camera[] = toestanden
      .filter((t) => t.entity_id.startsWith('camera.'))
      .map((t) => ({ id: t.entity_id, naam: naam(t), kamer: kamerVan.get(t.entity_id) ?? null, beweging: bewegingIn(kamerVan.get(t.entity_id)) }));
    // De voordeurcamera komt vooraan, zodat het scherm die standaard laat zien.
    const voordeur = this.instellingen.voordeur ?? cameras.find((c) => /voor|deur|bel|door/i.test(`${c.id} ${c.naam}`))?.id;
    cameras.sort((a, b) => Number(b.id === voordeur) - Number(a.id === voordeur));

    const scenes = toestanden.filter((t) => t.entity_id.startsWith('scene.')).map((t) => ({ id: t.entity_id, naam: naam(t) }));

    const weerEntiteit = toestanden.find((t) => t.entity_id.startsWith('weather.'));
    const weer = weerEntiteit
      ? {
          omschrijving: weerNamen[weerEntiteit.state] ?? weerEntiteit.state,
          temperatuur: typeof weerEntiteit.attributes.temperature === 'number' ? weerEntiteit.attributes.temperature : null,
        }
      : null;

    const binnenTemps = kamers.map((k) => k.temperatuur).filter((t): t is number => t !== null);
    const binnen = binnenTemps.length ? Math.round((binnenTemps.reduce((a, b) => a + b, 0) / binnenTemps.length) * 10) / 10 : null;

    return { bron: 'home-assistant', kamers, losseLampen, cameras, scenes, weer, binnen };
  }

  async bestaat(entiteit: string) {
    const antwoord = await fetch(`${this.instellingen.url}/api/states/${entiteit}`, {
      headers: { authorization: `Bearer ${this.instellingen.token}` },
      signal: AbortSignal.timeout(8000),
    });
    return antwoord.ok;
  }

  async lamp(entiteit: string, aan: boolean) {
    await this.vraag(`/api/services/light/${aan ? 'turn_on' : 'turn_off'}`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entiteit }),
    });
  }

  async scene(entiteit: string) {
    await this.vraag('/api/services/scene/turn_on', { method: 'POST', body: JSON.stringify({ entity_id: entiteit }) });
  }

  async cameraBeeld(entiteit: string) {
    const antwoord = await this.vraag(`/api/camera_proxy/${entiteit}`);
    return { type: antwoord.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(await antwoord.arrayBuffer()) };
  }

  /** Telefoons met de Home Assistant-app: dat zijn de notify-diensten die met mobile_app_ beginnen. */
  async toestellen(): Promise<Toestel[]> {
    const diensten = (await (await this.vraag('/api/services')).json()) as { domain: string; services: Record<string, unknown> }[];
    const notify = diensten.find((d) => d.domain === 'notify');
    return Object.keys(notify?.services ?? {})
      .filter((id) => id.startsWith('mobile_app_'))
      .map((id) => ({ id, naam: id.slice('mobile_app_'.length).replace(/_/g, ' ') }));
  }

  async melding(toestel: string, titel: string, tekst: string) {
    await this.vraag(`/api/services/notify/${toestel}`, {
      method: 'POST',
      body: JSON.stringify({ title: titel, message: tekst, data: { group: 'atlas', tag: `atlas-${titel}` } }),
    });
  }
}
