// Thuis en weg. Atlas kijkt elke halve minuut naar de personen in Home Assistant (die volgen de app op je telefoon).
// Gaat de laatste weg terwijl er nog lampen branden, dan komt er één melding met de knop "Alles uit". Die knop hoort
// Atlas terug via de websocket van Home Assistant. Alles staat standaard uit (tandwiel › Meldingen › Thuis en weg).
import type { HomeAssistant, Persoon } from './ha.js';
import { instellingen } from './instellingen.js';

export const ACTIE_ALLES_UIT = 'ATLAS_ALLES_UIT';
type Log = { info: (bericht: string) => void; warn: (bericht: unknown) => void };

export class Aanwezig {
  personen: Persoon[] = [];
  /** Iedereen weg: true; iemand thuis: false; onbekend (geen personen of geen Home Assistant): null. */
  weg: boolean | null = null;
  private socket: WebSocket | null = null;
  private wachtMetVerbinden = 5_000;

  constructor(
    private readonly ha: HomeAssistant | null,
    private readonly log: Log,
  ) {}

  start() {
    if (!this.ha) return;
    void this.kijk();
    setInterval(() => void this.kijk(), 30_000);
    this.verbind();
  }

  status() {
    return { bekend: this.weg !== null, weg: this.weg, personen: this.personen, aan: instellingen().weg.aan };
  }

  private async kijk() {
    if (!this.ha) return;
    try {
      this.personen = await this.ha.personen();
    } catch (fout) {
      this.log.warn(fout);
      return;
    }
    const was = this.weg;
    this.weg = this.personen.length ? this.personen.every((p) => !p.thuis) : null;
    // Alleen bij het weggaan zelf, niet bij het opstarten van Atlas terwijl je al weg bent.
    if (was === false && this.weg === true) await this.weggegaan();
  }

  private async weggegaan() {
    const inst = instellingen();
    if (!this.ha || !inst.weg.aan || !inst.weg.allesUit || !inst.meldingen.toestel) return;
    const aan = await this.ha.lampenAan().catch(() => [] as string[]);
    if (!aan.length) return;
    await this.ha
      .melding(inst.meldingen.toestel, 'Lampen nog aan', `Je bent weg en er ${aan.length === 1 ? 'brandt nog één lamp' : `branden nog ${aan.length} lampen`}.`, [
        { action: ACTIE_ALLES_UIT, title: 'Alles uit' },
      ])
      .catch((fout) => this.log.warn(fout));
  }

  /** Alle lampen uit; voor de knop in de melding. */
  async allesUit() {
    if (!this.ha) return 0;
    const aan = await this.ha.lampenAan();
    await Promise.all(aan.map((id) => this.ha!.lamp(id, { aan: false })));
    return aan.length;
  }

  /** Luistert naar knoppen in meldingen op de telefoon. Valt de verbinding weg, dan opnieuw na een steeds langere pauze. */
  private verbind() {
    if (!this.ha || typeof WebSocket === 'undefined') return;
    const { url, token } = this.ha.verbinding;
    const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/websocket`);
    this.socket = socket;
    socket.addEventListener('message', (e) => {
      const bericht = JSON.parse(String(e.data)) as { type: string; event?: { data?: { action?: string } } };
      if (bericht.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (bericht.type === 'auth_ok') {
        this.wachtMetVerbinden = 5_000;
        socket.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'mobile_app_notification_action' }));
      } else if (bericht.type === 'auth_invalid') {
        this.log.warn('Home Assistant weigerde de toegangscode op de websocket');
        socket.close();
      } else if (bericht.type === 'event' && bericht.event?.data?.action === ACTIE_ALLES_UIT) {
        this.allesUit()
          .then((n) => this.log.info(`Alles uit vanaf de telefoon: ${n} lampen`))
          .catch((fout) => this.log.warn(fout));
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      setTimeout(() => this.verbind(), this.wachtMetVerbinden);
      this.wachtMetVerbinden = Math.min(this.wachtMetVerbinden * 2, 5 * 60_000);
    });
    socket.addEventListener('error', () => socket.close());
  }
}
