// Koppeling met Home Assistant via de REST-API. Atlas vraagt zelf op welke ruimtes, lampen, camera's en scènes er zijn,
// dus er hoeft niets per lamp ingesteld te worden.

export type Lamp = {
  id: string;
  naam: string;
  aan: boolean;
  helderheid: number | null;
  /** Of de lamp te dimmen is; dan toont Atlas een schuifje. */
  dimbaar: boolean;
  /** Kleurtemperatuur in kelvin, als de lamp warm en koel wit kan. */
  kleurtemp: { min: number; max: number; nu: number | null } | null;
  bereikbaar: boolean;
};
/** Een instelling van een camera zelf, zoals het IR-licht, de nachtzichtstand of de sirene. */
export type CameraOptie = {
  id: string;
  naam: string;
  soort: 'switch' | 'light' | 'siren' | 'select' | 'number' | 'button';
  aan: boolean | null;
  waarde: string | number | null;
  keuzes?: string[];
  min?: number;
  max?: number;
  stap?: number;
  eenheid?: string;
  bereikbaar: boolean;
};
export type Kamer = { id: string; naam: string; verdieping: string | null; temperatuur: number | null; lampen: Lamp[] };
export type Camera = { id: string; naam: string; kamer: string | null; beweging: string | null };
export type Scene = { id: string; naam: string };
export type Toestel = { id: string; naam: string };
export type Apparaat = {
  id: string;
  naam: string;
  soort: string;
  /** De stand in gewone taal, bijvoorbeeld "21,5 °C" of "Open". */
  tekst: string;
  /** Aan of uit bij iets dat je kunt schakelen; anders null. */
  aan: boolean | null;
  /** Wat de knop doet: schakelen (aan/uit), starten (scène of script) of niets. */
  bediening: 'schakel' | 'start' | null;
  bereikbaar: boolean;
  /** Bij lampen: helderheid en kleurtemperatuur. */
  lamp?: Pick<Lamp, 'helderheid' | 'dimbaar' | 'kleurtemp'>;
};
export type Apparaten = { ruimtes: { id: string; naam: string; verdieping: string | null; apparaten: Apparaat[] }[]; overig: Apparaat[] };

/** Soorten die op het scherm Apparaten komen, in deze volgorde. Camera's hebben een eigen scherm. */
const SOORTEN = ['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'vacuum', 'lock', 'input_boolean', 'scene', 'script', 'sensor', 'binary_sensor', 'person', 'weather'];
/** De schakelaars die Frigate bij elke camera maakt, in het Nederlands. */
const FRIGATE_NAMEN: Record<string, string> = {
  detect: 'Detectie',
  recordings: 'Opnemen',
  snapshots: 'Snapshots',
  motion: 'Bewegingsdetectie',
  'improve contrast': 'Contrast verbeteren',
  'review alerts': 'Meldingen in Frigate',
  'review detections': 'Detecties in Frigate',
  'ptz autotracker': 'Automatisch volgen',
};
/** Soorten instellingen die bij een camera getoond worden, in deze volgorde. */
const CAMERA_SOORTEN: CameraOptie['soort'][] = ['light', 'switch', 'select', 'number', 'siren', 'button'];
/** Wat Atlas mag bedienen. Sloten bewust niet: die alleen bekijken. */
export const BEDIENBAAR = ['light', 'switch', 'fan', 'input_boolean', 'media_player', 'cover', 'scene', 'script'];
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

const getal = (w: unknown, unit?: unknown) => {
  const n = Number(w);
  if (!Number.isFinite(n)) return String(w);
  const tekst = n.toLocaleString('nl-NL', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 });
  return unit ? `${tekst} ${unit}` : tekst;
};

const binairNamen: Record<string, [string, string]> = {
  door: ['Open', 'Dicht'],
  window: ['Open', 'Dicht'],
  opening: ['Open', 'Dicht'],
  garage_door: ['Open', 'Dicht'],
  motion: ['Beweging', 'Geen beweging'],
  occupancy: ['Bezet', 'Vrij'],
  presence: ['Aanwezig', 'Afwezig'],
  moisture: ['Nat', 'Droog'],
  smoke: ['Rook!', 'Geen rook'],
  battery: ['Batterij laag', 'Batterij goed'],
  connectivity: ['Verbonden', 'Niet verbonden'],
  plug: ['Ingeplugd', 'Uitgeplugd'],
};

const staatNamen: Record<string, string> = {
  on: 'Aan',
  off: 'Uit',
  open: 'Open',
  closed: 'Dicht',
  opening: 'Gaat open',
  closing: 'Gaat dicht',
  playing: 'Speelt',
  paused: 'Gepauzeerd',
  idle: 'Inactief',
  standby: 'Stand-by',
  locked: 'Op slot',
  unlocked: 'Niet op slot',
  home: 'Thuis',
  not_home: 'Weg',
  docked: 'In station',
  cleaning: 'Zuigt',
  returning: 'Gaat terug',
  heat: 'Verwarmen',
  cool: 'Koelen',
  auto: 'Automatisch',
  unknown: '–',
  unavailable: 'Niet bereikbaar',
};

/** Helderheid en kleurtemperatuur van een lamp, voor zover de lamp dat kan. */
function lampDelen(t: Toestand): Pick<Lamp, 'helderheid' | 'dimbaar' | 'kleurtemp'> {
  const a = t.attributes;
  const standen = Array.isArray(a.supported_color_modes) ? (a.supported_color_modes as string[]) : [];
  const dimbaar = standen.some((s) => s !== 'onoff') || typeof a.brightness === 'number';
  const min = Number(a.min_color_temp_kelvin);
  const max = Number(a.max_color_temp_kelvin);
  const warmKoel = (standen.includes('color_temp') || standen.some((s) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(s))) && min > 0 && max > min;
  return {
    helderheid: typeof a.brightness === 'number' ? Math.round((a.brightness / 255) * 100) : null,
    dimbaar,
    kleurtemp: warmKoel ? { min, max, nu: typeof a.color_temp_kelvin === 'number' ? a.color_temp_kelvin : null } : null,
  };
}

/** De naam uit Home Assistant, of anders een leesbare naam uit de entiteit: sensor.woonkamer_temp wordt "Woonkamer temp". */
function vriendelijk(t: Toestand) {
  const naam = t.attributes.friendly_name?.trim();
  if (naam) return naam;
  const deel = t.entity_id.split('.').slice(1).join('.').replace(/_/g, ' ').trim();
  return deel ? deel.replace(/^\w/, (l) => l.toUpperCase()) : t.entity_id;
}

function alsApparaat(t: Toestand, ruimte?: string): Apparaat {
  const soort = t.entity_id.split('.')[0];
  const a = t.attributes;
  let naam = vriendelijk(t);
  // "Woonkamer Staande lamp" in de ruimte Woonkamer heet gewoon "Staande lamp".
  if (ruimte && naam.toLowerCase().startsWith(`${ruimte.toLowerCase()} `) && naam.length > ruimte.length + 1)
    naam = naam.slice(ruimte.length + 1).replace(/^\w/, (l) => l.toUpperCase());
  const bereikbaar = t.state !== 'unavailable';
  let tekst = staatNamen[t.state] ?? t.state;
  if (bereikbaar && t.state !== 'unknown') {
    if (soort === 'sensor') tekst = getal(t.state, a.unit_of_measurement);
    else if (soort === 'binary_sensor') {
      const namen = binairNamen[String(a.device_class)];
      if (namen) tekst = namen[t.state === 'on' ? 0 : 1];
    } else if (soort === 'light' && t.state === 'on' && typeof a.brightness === 'number') tekst = `Aan · ${Math.round((a.brightness / 255) * 100)}%`;
    else if (soort === 'cover' && typeof a.current_position === 'number') tekst = a.current_position === 0 ? 'Dicht' : `${a.current_position}% open`;
    else if (soort === 'climate') {
      const nu = a.current_temperature != null ? getal(a.current_temperature, '°C') : null;
      const doel = a.temperature != null ? getal(a.temperature, '°C') : null;
      tekst = [nu, doel && `naar ${doel}`].filter(Boolean).join(' ') || tekst;
    } else if (soort === 'media_player' && t.state === 'playing' && typeof a.media_title === 'string') tekst = `Speelt · ${a.media_title}`;
    else if (soort === 'weather') tekst = `${weerNamen[t.state] ?? t.state}${typeof a.temperature === 'number' ? ` · ${getal(a.temperature, '°C')}` : ''}`;
  }
  if (soort === 'scene' || soort === 'script') tekst = bereikbaar ? '' : tekst;
  const schakelbaar = ['light', 'switch', 'fan', 'input_boolean', 'media_player', 'cover'].includes(soort);
  return {
    id: t.entity_id,
    naam,
    soort,
    tekst,
    aan: schakelbaar ? !['off', 'closed', 'unavailable', 'unknown', 'standby'].includes(t.state) : null,
    bediening: schakelbaar ? 'schakel' : soort === 'scene' || soort === 'script' ? 'start' : null,
    bereikbaar,
    ...(soort === 'light' ? { lamp: lampDelen(t) } : {}),
  };
}

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
    const naam = vriendelijk;
    const kamerVan = new Map<string, string>();
    for (const r of ruimtes) for (const e of r.entiteiten) kamerVan.set(e, r.id);

    const alsLamp = (t: Toestand): Lamp => ({
      id: t.entity_id,
      naam: naam(t),
      aan: t.state === 'on',
      ...lampDelen(t),
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

  /** Alles uit Home Assistant dat ertoe doet, per ruimte. */
  async apparaten(): Promise<Apparaten> {
    const [toestanden, ruimtes] = await Promise.all([
      this.vraag('/api/states').then((a) => a.json() as Promise<Toestand[]>),
      this.haalRuimtes().catch(() => [] as Ruimte[]),
    ]);
    const getoond = (t: Toestand) => SOORTEN.includes(t.entity_id.split('.')[0]);
    const volgorde = (a: Apparaat, b: Apparaat) => SOORTEN.indexOf(a.soort) - SOORTEN.indexOf(b.soort) || a.naam.localeCompare(b.naam, 'nl');
    const perId = new Map(toestanden.map((t) => [t.entity_id, t]));
    const ingedeeld = new Set<string>();
    const lijst = ruimtes
      .map((r) => {
        const apparaten = r.entiteiten
          .map((e) => perId.get(e))
          .filter((t): t is Toestand => !!t && getoond(t))
          .map((t) => {
            ingedeeld.add(t.entity_id);
            return alsApparaat(t, r.naam);
          })
          .sort(volgorde);
        return { id: r.id, naam: r.naam, verdieping: r.verdieping, apparaten };
      })
      .filter((r) => r.apparaten.length);
    const overig = toestanden.filter((t) => getoond(t) && !ingedeeld.has(t.entity_id)).map((t) => alsApparaat(t)).sort(volgorde);
    return { ruimtes: lijst, overig };
  }

  /** Schakelt of start een apparaat. Alleen soorten uit BEDIENBAAR komen hier. */
  async bedien(entiteit: string, aan: boolean) {
    const soort = entiteit.split('.')[0];
    const dienst =
      soort === 'scene' || soort === 'script' ? 'turn_on' : soort === 'cover' ? (aan ? 'open_cover' : 'close_cover') : aan ? 'turn_on' : 'turn_off';
    await this.vraag(`/api/services/${soort}/${dienst}`, { method: 'POST', body: JSON.stringify({ entity_id: entiteit }) });
  }

  async bestaat(entiteit: string) {
    const antwoord = await fetch(`${this.instellingen.url}/api/states/${entiteit}`, {
      headers: { authorization: `Bearer ${this.instellingen.token}` },
      signal: AbortSignal.timeout(8000),
    });
    return antwoord.ok;
  }

  /** Lamp aan of uit, of dimmen (helderheid 1 tot 100) en warmer of koeler zetten (kelvin). */
  async lamp(entiteit: string, opdracht: { aan?: boolean; helderheid?: number; kelvin?: number }) {
    if (opdracht.aan === false) {
      await this.vraag('/api/services/light/turn_off', { method: 'POST', body: JSON.stringify({ entity_id: entiteit }) });
      return;
    }
    const extra: Record<string, number> = {};
    if (opdracht.helderheid != null) extra.brightness_pct = opdracht.helderheid;
    if (opdracht.kelvin != null) extra.color_temp_kelvin = opdracht.kelvin;
    await this.vraag('/api/services/light/turn_on', { method: 'POST', body: JSON.stringify({ entity_id: entiteit, ...extra }) });
  }

  /**
   * De instellingen van een camera zelf: alles op het apparaat van de camera in Home Assistant, plus wat er qua naam bij
   * hoort (de camera-integratie en Frigate maken vaak elk een eigen apparaat, bijvoorbeeld "Voordeur IR-licht").
   * Knoppen die de camera herstarten, resetten of bijwerken laat Atlas bewust weg.
   */
  async cameraOpties(camera: string): Promise<CameraOptie[]> {
    const sjabloon = `{% set d = device_id('${camera}') %}{{ (device_entities(d) if d else []) | tojson }}`;
    const [toestanden, eigen] = await Promise.all([
      this.vraag('/api/states').then((a) => a.json() as Promise<Toestand[]>),
      this.vraag('/api/template', { method: 'POST', body: JSON.stringify({ template: sjabloon }) })
        .then(async (a) => JSON.parse(await a.text()) as string[])
        .catch(() => [] as string[]),
    ]);
    const cam = toestanden.find((t) => t.entity_id === camera);
    if (!cam) return [];
    const camNaam = (cam.attributes.friendly_name ?? '').toLowerCase();
    const slug = camera.split('.')[1];
    const hoortErbij = (t: Toestand) => {
      const [, object] = t.entity_id.split('.');
      const naam = (t.attributes.friendly_name ?? '').toLowerCase();
      return eigen.includes(t.entity_id) || object.startsWith(`${slug}_`) || (camNaam.length > 2 && naam.startsWith(`${camNaam} `));
    };
    const verboden = /reboot|restart|herstart|reset|update|firmware|format|factory|fabriek|wis|delete|identify/i;
    const opties: CameraOptie[] = [];
    for (const t of toestanden) {
      const soort = t.entity_id.split('.')[0] as CameraOptie['soort'];
      if (!CAMERA_SOORTEN.includes(soort) || !hoortErbij(t)) continue;
      if (verboden.test(t.entity_id) || verboden.test(t.attributes.friendly_name ?? '')) continue;
      if (t.attributes.entity_category === 'diagnostic') continue;
      let naam = t.attributes.friendly_name ?? t.entity_id;
      if (camNaam && naam.toLowerCase().startsWith(`${camNaam} `)) naam = naam.slice(camNaam.length + 1).replace(/^\w/, (l) => l.toUpperCase());
      naam = FRIGATE_NAMEN[naam.toLowerCase()] ?? naam;
      const a = t.attributes;
      opties.push({
        id: t.entity_id,
        naam,
        soort,
        aan: ['switch', 'light', 'siren'].includes(soort) ? t.state === 'on' : null,
        waarde: soort === 'number' ? Number(t.state) : soort === 'select' ? t.state : null,
        ...(soort === 'select' && Array.isArray(a.options) ? { keuzes: a.options as string[] } : {}),
        ...(soort === 'number'
          ? { min: Number(a.min ?? 0), max: Number(a.max ?? 100), stap: Number(a.step ?? 1), eenheid: typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : undefined }
          : {}),
        bereikbaar: t.state !== 'unavailable',
      });
    }
    return opties.sort((x, y) => CAMERA_SOORTEN.indexOf(x.soort) - CAMERA_SOORTEN.indexOf(y.soort) || x.naam.localeCompare(y.naam, 'nl'));
  }

  /** Zet één camera-instelling; de waarde is al gecontroleerd tegen wat cameraOpties gaf. */
  async cameraOptie(optie: CameraOptie, waarde: boolean | string | number | null) {
    const [soort] = optie.id.split('.');
    const dienst =
      soort === 'select' ? 'select_option' : soort === 'number' ? 'set_value' : soort === 'button' ? 'press' : waarde ? 'turn_on' : 'turn_off';
    const extra = soort === 'select' ? { option: waarde } : soort === 'number' ? { value: waarde } : {};
    await this.vraag(`/api/services/${soort}/${dienst}`, { method: 'POST', body: JSON.stringify({ entity_id: optie.id, ...extra }) });
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
