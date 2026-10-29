// Blokken voor de apps op de thuisserver: Frigate, Jellyfin, Seerr en downloads (Sonarr en Radarr). Atlas vindt de
// apps zelf. Wat zonder inlog kan (of de app draait) werkt meteen; voor de inhoud is een API-sleutel uit de omgeving nodig.
import { instellingen } from './instellingen.js';
import type { Meldingen } from './meldingen.js';
import { Dienst, controles } from './zoek.js';

type Log = { info: (bericht: string) => void; warn: (bericht: unknown) => void };

const sleutel = (naam: string) => process.env[`${naam}_KEY`]?.trim() || null;

async function vraag<T>(adres: string, pad: string, kop: Record<string, string> = {}): Promise<T> {
  const antwoord = await fetch(`${adres}${pad}`, { headers: kop, signal: AbortSignal.timeout(8000) });
  if (!antwoord.ok) throw new Error(`${adres}${pad.split('?')[0]} gaf ${antwoord.status}`);
  return (await antwoord.json()) as T;
}

type JellyItem = {
  Id: string;
  Name: string;
  SeriesName?: string;
  Type: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  UserData?: { PlayedPercentage?: number };
};

export class Apps {
  private readonly frigate: Dienst;
  private readonly jellyfin: Dienst;
  private readonly seerr: Dienst;
  private readonly sonarr: Dienst;
  private readonly radarr: Dienst;
  private jellyGebruiker: string | null = null;

  constructor(
    private readonly meldingen: Meldingen,
    private readonly log: Log,
  ) {
    this.frigate = meldingen.frigate;
    this.jellyfin = new Dienst('Jellyfin', 'jellyfin', 8096, controles.jellyfin, log);
    this.seerr = new Dienst('Seerr', 'jellyseerr', 5055, controles.seerr, log);
    this.sonarr = new Dienst('Sonarr', 'sonarr', 8989, controles.arr, log);
    this.radarr = new Dienst('Radarr', 'radarr', 7878, controles.arr, log);
  }

  /** Alleen de blokken die aan staan, zodat uitgezette apps niet steeds bevraagd worden. */
  async alles() {
    const aan = instellingen().blokken;
    const [frigate, jellyfin, seerr, downloads] = await Promise.all([
      aan.frigate ? this.frigateBlok() : null,
      aan.jellyfin ? this.jellyfinBlok() : null,
      aan.seerr ? this.seerrBlok() : null,
      aan.downloads ? this.downloadsBlok() : null,
    ]);
    return { frigate, jellyfin, seerr, downloads };
  }

  private async veilig<T>(werk: () => Promise<T>): Promise<T | null> {
    try {
      return await werk();
    } catch (fout) {
      this.log.warn(fout);
      return null;
    }
  }

  private async frigateBlok() {
    const adres = await this.frigate.vind();
    if (!adres) return { gevonden: false, poort: this.frigate.poort };
    const middernacht = new Date();
    middernacht.setHours(0, 0, 0, 0);
    const soorten = instellingen().meldingen.soorten;
    const gebeurtenissen = await this.veilig(() =>
      vraag<{ id: string; camera: string; label: string; start_time: number }[]>(
        adres,
        `/api/events?limit=500&after=${Math.floor(middernacht.getTime() / 1000)}`,
      ),
    );
    const telling: Record<string, number> = {};
    for (const g of gebeurtenissen ?? []) telling[g.label] = (telling[g.label] ?? 0) + 1;
    const laatste = (gebeurtenissen ?? [])
      .filter((g) => soorten.includes(g.label))
      .sort((a, b) => b.start_time - a.start_time)
      .slice(0, 3)
      .map((g) => ({
        id: g.id,
        camera: g.camera,
        soort: g.label,
        tijd: new Date(g.start_time * 1000).toISOString(),
        beeld: `/api/meldingen/${encodeURIComponent(g.id)}/beeld`,
      }));
    return { gevonden: true, poort: this.frigate.poort, bereikbaar: gebeurtenissen != null, vandaag: telling, laatste };
  }

  private async jellyfinBlok() {
    const adres = await this.jellyfin.vind();
    if (!adres) return { gevonden: false, poort: this.jellyfin.poort };
    const key = sleutel('JELLYFIN');
    if (!key) return { gevonden: true, poort: this.jellyfin.poort, sleutel: false };
    const kop = { 'X-Emby-Token': key };
    const inhoud = await this.veilig(async () => {
      if (!this.jellyGebruiker) {
        const gebruikers = await vraag<{ Id: string; Policy?: { IsAdministrator?: boolean } }[]>(adres, '/Users', kop);
        this.jellyGebruiker = (gebruikers.find((g) => g.Policy?.IsAdministrator) ?? gebruikers[0])?.Id ?? null;
      }
      if (!this.jellyGebruiker) return { verder: [], nieuw: [] };
      const [verder, nieuw] = await Promise.all([
        vraag<{ Items: JellyItem[] }>(adres, `/Users/${this.jellyGebruiker}/Items/Resume?Limit=3&MediaTypes=Video`, kop),
        vraag<JellyItem[]>(adres, `/Users/${this.jellyGebruiker}/Items/Latest?Limit=6`, kop),
      ]);
      const item = (i: JellyItem) => ({
        id: i.Id,
        titel: i.SeriesName ?? i.Name,
        sub: i.SeriesName ? `S${i.ParentIndexNumber ?? '?'} A${i.IndexNumber ?? '?'} · ${i.Name}` : i.Type === 'Movie' ? 'Film' : '',
        voortgang: i.UserData?.PlayedPercentage != null ? Math.round(i.UserData.PlayedPercentage) : null,
        beeld: `/api/apps/jellyfin/beeld/${encodeURIComponent(i.Id)}`,
      });
      return { verder: verder.Items.map(item), nieuw: nieuw.map(item) };
    });
    return { gevonden: true, poort: this.jellyfin.poort, sleutel: true, bereikbaar: inhoud != null, ...(inhoud ?? { verder: [], nieuw: [] }) };
  }

  async jellyfinBeeld(id: string) {
    if (!this.jellyfin.adres || !/^[a-f0-9-]{8,40}$/i.test(id)) return null;
    const antwoord = await fetch(`${this.jellyfin.adres}/Items/${id}/Images/Primary?maxHeight=240&quality=80`, { signal: AbortSignal.timeout(8000) });
    if (!antwoord.ok) return null;
    return { type: antwoord.headers.get('content-type') ?? 'image/jpeg', data: Buffer.from(await antwoord.arrayBuffer()) };
  }

  private async seerrBlok() {
    const adres = await this.seerr.vind();
    if (!adres) return { gevonden: false, poort: this.seerr.poort };
    const key = sleutel('SEERR');
    if (!key) return { gevonden: true, poort: this.seerr.poort, sleutel: false };
    const telling = await this.veilig(() =>
      vraag<{ pending: number; processing: number; available: number }>(adres, '/api/v1/request/count', { 'X-Api-Key': key }),
    );
    return {
      gevonden: true,
      poort: this.seerr.poort,
      sleutel: true,
      bereikbaar: telling != null,
      wachtend: telling?.pending ?? 0,
      bezig: telling?.processing ?? 0,
      beschikbaar: telling?.available ?? 0,
    };
  }

  private async downloadsBlok() {
    const [sonarr, radarr] = await Promise.all([this.sonarr.vind(), this.radarr.vind()]);
    const apps = [
      { naam: 'Sonarr', dienst: this.sonarr, adres: sonarr, key: sleutel('SONARR') },
      { naam: 'Radarr', dienst: this.radarr, adres: radarr, key: sleutel('RADARR') },
    ].filter((a) => a.adres);
    if (!apps.length) return { gevonden: false, apps: [] };
    const items = [];
    for (const app of apps) {
      if (!app.key) continue;
      const rij = await this.veilig(() =>
        vraag<{ records: { title: string; size: number; sizeleft: number; timeleft?: string; status: string }[] }>(
          app.adres!,
          '/api/v3/queue?pageSize=10',
          { 'X-Api-Key': app.key! },
        ),
      );
      for (const r of rij?.records ?? [])
        items.push({
          app: app.naam,
          titel: r.title,
          voortgang: r.size ? Math.round((1 - r.sizeleft / r.size) * 100) : 0,
          resterend: r.timeleft ?? null,
          status: r.status,
        });
    }
    return {
      gevonden: true,
      apps: apps.map((a) => ({ naam: a.naam, poort: a.dienst.poort, sleutel: !!a.key })),
      items: items.slice(0, 6),
    };
  }
}
