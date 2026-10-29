// Apps op de thuisserver zelf vinden, zodat er geen adressen ingevuld hoeven te worden. Atlas probeert de standaardpoort
// van een app als container met die naam, op de server zelf en op de machine van Home Assistant. Een adres in de
// omgeving (bijvoorbeeld FRIGATE_URL) gaat altijd voor.

type Log = { info: (bericht: string) => void };

function plekken(container: string, poort: number) {
  const adressen = [`http://${container}:${poort}`, `http://host.docker.internal:${poort}`, `http://172.17.0.1:${poort}`];
  try {
    adressen.push(`http://${new URL(process.env.HA_URL ?? '').hostname}:${poort}`);
  } catch {
    // Geen HA_URL, dan alleen de standaardplekken.
  }
  return [...new Set(adressen)];
}

export class Dienst {
  adres: string | null;
  private readonly adressen: string[];
  private gezocht = 0;

  constructor(
    readonly naam: string,
    /** Container-naam en omgevingsvariabele, bijvoorbeeld frigate en FRIGATE_URL. */
    container: string,
    readonly poort: number,
    /** Een adres dat zonder inlog antwoordt, en hoe je ziet dat het echt deze app is. */
    private readonly controle: { pad: string; klopt: (tekst: string) => boolean },
    private readonly log: Log,
  ) {
    const vast = process.env[`${container.toUpperCase()}_URL`]?.trim().replace(/\/+$/, '');
    this.adressen = vast ? [vast] : plekken(container, poort);
    this.adres = vast ?? null;
  }

  /**
   * Geeft het adres. Zolang de app niet gevonden is, zoekt Atlas hooguit eens per minuut opnieuw; alleen de eerste
   * zoektocht wordt afgewacht, daarna zoekt Atlas op de achtergrond zodat een scherm niet hoeft te wachten.
   */
  async vind() {
    if (this.adres || Date.now() - this.gezocht < 60_000) return this.adres;
    const eerste = this.gezocht === 0;
    this.gezocht = Date.now();
    const zoektocht = this.zoek();
    if (eerste) await zoektocht;
    return this.adres;
  }

  private async zoek() {
    for (const adres of this.adressen) {
      try {
        const antwoord = await fetch(`${adres}${this.controle.pad}`, { signal: AbortSignal.timeout(3000) });
        if (antwoord.ok && this.controle.klopt(await antwoord.text())) {
          this.adres = adres;
          this.log.info(`${this.naam} gevonden op ${adres}`);
          return;
        }
      } catch {
        // Niet hier, volgende proberen.
      }
    }
  }
}

const json = (tekst: string) => {
  try {
    return JSON.parse(tekst) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const controles = {
  frigate: { pad: '/api/version', klopt: (t: string) => /^\d+\.\d+/.test(t.trim()) },
  jellyfin: { pad: '/System/Info/Public', klopt: (t: string) => typeof json(t).ServerName === 'string' },
  seerr: { pad: '/api/v1/status', klopt: (t: string) => typeof json(t).version === 'string' },
  // Sonarr en Radarr antwoorden zonder sleutel op /ping met {"status":"OK"}.
  arr: { pad: '/ping', klopt: (t: string) => json(t).status === 'OK' },
};
