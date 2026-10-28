// Google Agenda en Gmail, alleen lezen. Vince maakt zelf een gratis OAuth-client (type "Desktop-app") in Google Cloud;
// na toestemming plakt hij het adres waar Google naartoe stuurt in Atlas, waarna de server de sleutel bewaart.
import { randomBytes } from 'node:crypto';
import { bewaar, lees } from './opslag.js';

export type Afspraak = { tijd: string; titel: string; detail: string; kleur: string | null };
export type Mail = { van: string; onderwerp: string; link: string };
export type Agenda = { id: string; naam: string; kleur: string | null; aan: boolean };

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly'];
// Een desktop-client mag naar een adres op de eigen computer sturen. Daar draait niets, dus de browser toont een
// foutpagina, maar het adres in de adresbalk bevat de code die Atlas nodig heeft.
const TERUG = 'http://127.0.0.1:8790/google';
const tijdzone = process.env.TZ_ATLAS ?? 'Europe/Amsterdam';

type Opslag = { verversSleutel: string | null; staat: string | null; agendas: Record<string, boolean> };

export class Google {
  private opslag = lees<Opslag>('google', { verversSleutel: null, staat: null, agendas: {} });
  private toegang: { sleutel: string; tot: number } | null = null;
  private cache = new Map<string, { tijd: number; waarde: unknown }>();

  constructor(
    private readonly clientId: string,
    private readonly clientGeheim: string,
  ) {}

  static uitOmgeving() {
    const id = process.env.GOOGLE_CLIENT_ID?.trim();
    const geheim = process.env.GOOGLE_CLIENT_SECRET?.trim();
    return id && geheim ? new Google(id, geheim) : null;
  }

  get gekoppeld() {
    return !!this.opslag.verversSleutel;
  }

  private bewaar() {
    bewaar('google', this.opslag);
  }

  koppelAdres() {
    this.opslag.staat = randomBytes(16).toString('hex');
    this.bewaar();
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: TERUG,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: this.opslag.staat,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  /** Neemt het geplakte adres (of alleen de code) aan en wisselt het in voor een blijvende sleutel. */
  async koppel(geplakt: string) {
    let code = geplakt.trim();
    if (code.startsWith('http')) {
      const adres = new URL(code);
      if (adres.searchParams.get('error')) throw new Error('Google gaf geen toestemming');
      if (adres.searchParams.get('state') !== this.opslag.staat) throw new Error('Dit adres hoort niet bij de laatste koppelpoging');
      code = adres.searchParams.get('code') ?? '';
    }
    if (!code) throw new Error('Geen code gevonden in wat je plakte');
    const antwoord = await this.token({ code, grant_type: 'authorization_code', redirect_uri: TERUG });
    if (!antwoord.refresh_token) throw new Error('Google gaf geen blijvende sleutel terug');
    this.opslag.verversSleutel = antwoord.refresh_token;
    this.opslag.staat = null;
    this.bewaar();
    this.toegang = { sleutel: antwoord.access_token, tot: Date.now() + (antwoord.expires_in - 60) * 1000 };
    this.cache.clear();
  }

  ontkoppel() {
    this.opslag.verversSleutel = null;
    this.toegang = null;
    this.cache.clear();
    this.bewaar();
  }

  private async token(velden: Record<string, string>) {
    const antwoord = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientGeheim, ...velden }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await antwoord.json()) as { access_token: string; expires_in: number; refresh_token?: string; error?: string };
    if (!antwoord.ok) {
      // Een ingetrokken of verlopen sleutel werkt nooit meer; dan moet Vince opnieuw koppelen.
      if (data.error === 'invalid_grant' && velden.grant_type === 'refresh_token') this.ontkoppel();
      throw new Error(`Google weigerde de sleutel (${data.error ?? antwoord.status})`);
    }
    return data;
  }

  private async vraag<T>(adres: string): Promise<T> {
    if (!this.opslag.verversSleutel) throw new Error('Google is niet gekoppeld');
    if (!this.toegang || Date.now() > this.toegang.tot) {
      const t = await this.token({ refresh_token: this.opslag.verversSleutel, grant_type: 'refresh_token' });
      this.toegang = { sleutel: t.access_token, tot: Date.now() + (t.expires_in - 60) * 1000 };
    }
    const antwoord = await fetch(adres, { headers: { authorization: `Bearer ${this.toegang.sleutel}` }, signal: AbortSignal.timeout(10_000) });
    if (!antwoord.ok) throw new Error(`Google gaf ${antwoord.status} op ${new URL(adres).pathname}`);
    return antwoord.json() as Promise<T>;
  }

  // Google rekent een minuut als vers genoeg; het scherm vraagt elke minuut.
  private async bewaard<T>(sleutel: string, maak: () => Promise<T>): Promise<T> {
    const oud = this.cache.get(sleutel);
    if (oud && Date.now() - oud.tijd < 55_000) return oud.waarde as T;
    const waarde = await maak();
    this.cache.set(sleutel, { tijd: Date.now(), waarde });
    return waarde;
  }

  async agendas(): Promise<Agenda[]> {
    const lijst = await this.bewaard('agendas', () =>
      this.vraag<{ items: { id: string; summary: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean }[] }>(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      ),
    );
    return lijst.items
      .map((a) => ({ id: a.id, naam: a.summaryOverride ?? a.summary, kleur: a.backgroundColor ?? null, aan: this.opslag.agendas[a.id] ?? true, eerst: !!a.primary }))
      .sort((a, b) => Number(b.eerst) - Number(a.eerst) || a.naam.localeCompare(b.naam, 'nl'))
      .map(({ eerst: _eerst, ...a }) => a);
  }

  zetAgenda(id: string, aan: boolean) {
    this.opslag.agendas[id] = aan;
    this.bewaar();
    this.cache.delete('afspraken');
  }

  async afspraken(): Promise<{ vandaag: Afspraak[]; morgen: string }> {
    return this.bewaard('afspraken', async () => {
      const agendas = (await this.agendas()).filter((a) => a.aan);
      const nu = new Date();
      const van = new Date(nu.getTime() - 24 * 3600_000).toISOString();
      const tot = new Date(nu.getTime() + 48 * 3600_000).toISOString();
      type Item = { summary?: string; status?: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } };
      const perAgenda = await Promise.all(
        agendas.map(async (a) => {
          const p = new URLSearchParams({ timeMin: van, timeMax: tot, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
          const data = await this.vraag<{ items: Item[] }>(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(a.id)}/events?${p}`);
          return data.items.filter((i) => i.status !== 'cancelled').map((i) => ({ ...i, agenda: a }));
        }),
      );

      const dag = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: tijdzone });
      const uur = (iso: string) => new Date(iso).toLocaleTimeString('nl-NL', { timeZone: tijdzone, hour: '2-digit', minute: '2-digit' });
      const vandaag = dag(nu);
      const morgen = dag(new Date(nu.getTime() + 24 * 3600_000));
      // Een hele-dag-afspraak heeft een datum zonder tijd en loopt tot (niet tot en met) de einddatum.
      const opDag = (i: Item, d: string) => (i.start.date ? i.start.date <= d && d < (i.end.date ?? i.start.date) : dag(new Date(i.start.dateTime!)) === d);
      const sorteer = (i: Item) => i.start.dateTime ?? `${i.start.date}T00:00`;
      const alle = perAgenda.flat().sort((a, b) => sorteer(a).localeCompare(sorteer(b)));

      const lijst = alle
        .filter((i) => opDag(i, vandaag) && (i.start.date || new Date(i.end.dateTime!) > nu))
        .map((i) => ({
          tijd: i.start.dateTime ? uur(i.start.dateTime) : 'Dag',
          titel: i.summary ?? '(geen titel)',
          detail: i.end.dateTime ? `tot ${uur(i.end.dateTime)}` : i.agenda.naam,
          kleur: i.agenda.kleur,
        }));
      const eerste = alle.find((i) => opDag(i, morgen));
      const morgenTekst = eerste ? `${eerste.start.dateTime ? uur(eerste.start.dateTime) : 'Hele dag'} · ${eerste.summary ?? '(geen titel)'}` : '';
      return { vandaag: lijst, morgen: morgenTekst };
    });
  }

  async mail(): Promise<{ mail: Mail[]; aantal: number }> {
    return this.bewaard('mail', async () => {
      const p = new URLSearchParams({ q: 'is:unread is:important in:inbox', maxResults: '5' });
      const lijst = await this.vraag<{ messages?: { id: string; threadId: string }[]; resultSizeEstimate?: number }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${p}`,
      );
      const mail = await Promise.all(
        (lijst.messages ?? []).map(async (m) => {
          const kop = new URLSearchParams([['format', 'metadata'], ['metadataHeaders', 'From'], ['metadataHeaders', 'Subject']]);
          const bericht = await this.vraag<{ payload: { headers: { name: string; value: string }[] } }>(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?${kop}`,
          );
          const veld = (naam: string) => bericht.payload.headers.find((h) => h.name.toLowerCase() === naam)?.value ?? '';
          const van = veld('from').replace(/\s*<[^>]*>\s*$/, '').replace(/^"(.*)"$/, '$1') || veld('from');
          return { van, onderwerp: veld('subject') || '(geen onderwerp)', link: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}` };
        }),
      );
      return { mail, aantal: lijst.resultSizeEstimate ?? mail.length };
    });
  }
}
