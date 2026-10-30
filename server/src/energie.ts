// Energie en klimaat: wat het huis nu verbruikt, wat het vandaag verbruikte en hoe warm en vochtig elke ruimte is.
// Atlas zoekt de meters zelf in Home Assistant op soort en naam, zodat er niets ingesteld hoeft te worden. Een P1-meter
// (DSMR, HomeWizard) geeft stroom en gas; zonnepanelen geven opwek.

export type Energie = {
  bron: 'home-assistant' | 'voorbeeld';
  /** Wat het huis nu van het net haalt in watt; negatief als er teruggeleverd wordt. */
  vermogen: number | null;
  /** Verbruik sinds middernacht. Stroom, terug en opwek in kWh, gas in m³. */
  vandaag: { stroom: number | null; terug: number | null; gas: number | null; opwek: number | null };
  thermostaat: { id: string; naam: string; huidig: number | null; doel: number | null; stand: string } | null;
  kamers: { id: string; naam: string; temperatuur: number | null; vocht: number | null }[];
};

type Toestand = { entity_id: string; state: string; attributes: Record<string, unknown> & { friendly_name?: string } };
type Ruimte = { id: string; naam: string; entiteiten: string[] };

/** Welke meters Atlas gebruikt; bij een P1-meter met twee tarieven zijn het er twee per soort. */
export type Meters = { vermogen: string[]; terugVermogen: string[]; stroom: string[]; terug: string[]; gas: string[]; opwek: string[] };

const tekst = (t: Toestand) => `${t.entity_id} ${t.attributes.friendly_name ?? ''}`.toLowerCase();
const getal = (t: Toestand | undefined) => {
  const n = Number(t?.state);
  return t && t.state !== '' && Number.isFinite(n) ? n : null;
};
const soort = (t: Toestand) => t.attributes.device_class;
const isMeter = (t: Toestand) => t.entity_id.startsWith('sensor.') && ['total_increasing', 'total'].includes(String(t.attributes.state_class));

const TERUG = /returned|export|teruglever|terug|injection|produced_to_grid/;
const OPWEK = /solar|zon|pv\b|_pv|inverter|omvormer|opwek|yield|production|productie/;
// Bewust zonder "consumption": dat heten slimme stekkers ook. De P1-meter herken je aan zijn naam.
const NET = /p1|dsmr|homewizard|import|delivered|afname|tari|grid|net\b|_net|electricity_meter|stroommeter|slimme_meter/;
const FASE = /phase|fase|_l[123]\b/;
const TARIEF = /tari|_t1|_t2|_1$|_2$|low|high|laag|hoog|normal|dal|piek/;

/** Bij een meter met zowel een totaal als losse tarieven: het totaal, anders de tarieven bij elkaar. */
function totaalOfTarieven(lijst: Toestand[]) {
  const totaal = lijst.filter((t) => !TARIEF.test(t.entity_id));
  return (totaal.length ? totaal.slice(0, 1) : lijst).map((t) => t.entity_id);
}

export function kiesMeters(toestanden: Toestand[]): Meters {
  const energie = toestanden.filter((t) => isMeter(t) && soort(t) === 'energy');
  // "Productie" op de P1-meter is teruglevering aan het net; productie van een omvormer is opwek.
  const opwek = energie.filter((t) => OPWEK.test(tekst(t)) && !NET.test(tekst(t)));
  const terug = energie.filter((t) => !opwek.includes(t) && (TERUG.test(tekst(t)) || (NET.test(tekst(t)) && OPWEK.test(tekst(t)))));
  const stroom = energie.filter((t) => NET.test(tekst(t)) && !terug.includes(t) && !opwek.includes(t));
  const gas = toestanden.filter((t) => isMeter(t) && soort(t) === 'gas');
  // Vermogen alleen van een meter op de aansluiting; een stekker of lamp is niet "het huis".
  const vermogen = toestanden.filter((t) => t.entity_id.startsWith('sensor.') && soort(t) === 'power' && NET.test(tekst(t)) && !FASE.test(t.entity_id));
  const terugVermogen = vermogen.filter((t) => TERUG.test(tekst(t)) || OPWEK.test(tekst(t)));
  const afname = vermogen.filter((t) => !terugVermogen.includes(t));
  return {
    vermogen: afname.slice(0, 1).map((t) => t.entity_id),
    terugVermogen: afname.length ? terugVermogen.slice(0, 1).map((t) => t.entity_id) : [],
    stroom: totaalOfTarieven(stroom),
    terug: totaalOfTarieven(terug),
    gas: gas.slice(0, 1).map((t) => t.entity_id),
    opwek: totaalOfTarieven(opwek),
  };
}

/** Een meterstand in kWh (of m³ bij gas), ook als de meter in Wh telt. */
function inKwh(t: Toestand | undefined, waarde = getal(t)) {
  if (waarde == null || !t) return null;
  const eenheid = String(t.attributes.unit_of_measurement ?? '');
  return eenheid === 'Wh' ? waarde / 1000 : eenheid === 'MWh' ? waarde * 1000 : waarde;
}
const inWatt = (t: Toestand | undefined) => {
  const w = getal(t);
  if (w == null || !t) return null;
  return t.attributes.unit_of_measurement === 'kW' ? w * 1000 : w;
};

const HVAC: Record<string, string> = { heating: 'Verwarmt', cooling: 'Koelt', idle: 'Rust', off: 'Uit', drying: 'Droogt', fan: 'Ventileert', preheating: 'Warmt voor' };
const STAND: Record<string, string> = { heat: 'Verwarmen', cool: 'Koelen', auto: 'Automatisch', heat_cool: 'Automatisch', off: 'Uit', dry: 'Drogen', fan_only: 'Ventileren' };

const rond = (n: number | null, stappen = 10) => (n == null ? null : Math.round(n * stappen) / stappen);

/**
 * Zet de toestanden om in het blok Energie. `begin` geeft per meter de stand om middernacht; het verbruik van vandaag is
 * de stand nu min die van middernacht. Begon de meter opnieuw te tellen (een nieuwe meter), dan telt de stand van nu.
 */
export function energieUit(toestanden: Toestand[], ruimtes: Ruimte[], meters: Meters, begin: Record<string, number>): Energie {
  const perId = new Map(toestanden.map((t) => [t.entity_id, t]));
  const vandaag = (ids: string[]) => {
    let som: number | null = null;
    for (const id of ids) {
      const t = perId.get(id);
      const nu = inKwh(t);
      if (nu == null) continue;
      const toen = Number.isFinite(begin[id]) ? inKwh(t, begin[id]) : null;
      if (toen == null) continue;
      som = (som ?? 0) + (nu >= toen ? nu - toen : nu);
    }
    return rond(som, 100);
  };
  const af = meters.vermogen.length ? inWatt(perId.get(meters.vermogen[0])) : null;
  const op = meters.terugVermogen.length ? inWatt(perId.get(meters.terugVermogen[0])) ?? 0 : 0;

  const klimaat = toestanden.find((t) => t.entity_id.startsWith('climate.') && t.state !== 'unavailable');
  const thermostaat = klimaat
    ? {
        id: klimaat.entity_id,
        naam: klimaat.attributes.friendly_name ?? 'Thermostaat',
        huidig: typeof klimaat.attributes.current_temperature === 'number' ? klimaat.attributes.current_temperature : null,
        doel: typeof klimaat.attributes.temperature === 'number' ? klimaat.attributes.temperature : null,
        stand: HVAC[String(klimaat.attributes.hvac_action)] ?? STAND[klimaat.state] ?? klimaat.state,
      }
    : null;

  const meet = (eigen: Toestand[], klasse: string) => {
    const t = eigen.find((x) => x.entity_id.startsWith('sensor.') && soort(x) === klasse && getal(x) != null);
    return t ? rond(getal(t)) : null;
  };
  const kamers = ruimtes
    .map((r) => {
      const eigen = r.entiteiten.map((e) => perId.get(e)).filter((t): t is Toestand => !!t);
      return { id: r.id, naam: r.naam, temperatuur: meet(eigen, 'temperature'), vocht: meet(eigen, 'humidity') };
    })
    .filter((k) => k.temperatuur != null || k.vocht != null);

  return {
    bron: 'home-assistant',
    vermogen: af == null ? null : Math.round(af - op),
    vandaag: { stroom: vandaag(meters.stroom), terug: vandaag(meters.terug), gas: vandaag(meters.gas), opwek: vandaag(meters.opwek) },
    thermostaat,
    kamers,
  };
}

/** Middernacht vandaag in Nederlandse tijd, ook als de server in een andere tijdzone draait. */
export function middernacht(nu = new Date()) {
  const datum = nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  const utc = new Date(`${datum}T00:00:00Z`);
  const daar = new Date(`${utc.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' }).replace(' ', 'T')}Z`);
  return new Date(utc.getTime() - (daar.getTime() - utc.getTime()));
}
