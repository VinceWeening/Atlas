import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Google } from './google.js';
import { BEDIENBAAR, HomeAssistant, haInstellingen } from './ha.js';
import { SOORTEN, instellingen, zetInstellingen } from './instellingen.js';
import { Meldingen } from './meldingen.js';
import { Apps } from './apps.js';
import { voerUit } from './opdracht.js';
import { Aanwezig } from './aanwezig.js';
import { regen, volgendeVertrek } from './vertrek.js';
import { middernacht } from './energie.js';
import { naarTekst, spraakAan, spraakBereikbaar } from './spraak.js';
import { aiBereikbaar, herschrijf } from './ai.js';
import { versie } from './versie.js';
import { VoorbeeldHuis, voorbeeld } from './voorbeeld.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(process.env.WEB_DIR ?? resolve(here, '../../web/dist'));
const port = Number(process.env.PORT ?? 8790);

const app = Fastify({ logger: true });

// De Windows-app controleert vanaf zijn eigen startpagina of de server bereikbaar is, dus deze route mag van elke herkomst.
app.get('/api/health', async (_request, reply) => {
  reply.header('access-control-allow-origin', '*');
  return { ok: true, naam: 'atlas', versie: process.env.ATLAS_VERSION ?? 'dev' };
});

const ha = haInstellingen();
const huis = ha ? new HomeAssistant(ha) : new VoorbeeldHuis();
app.log.info(ha ? `Home Assistant op ${ha.url}` : 'Geen HA_URL en HA_TOKEN ingesteld, het huis toont voorbeeldgegevens.');

/** Zet de eigen namen uit het tandwiel over de namen uit Home Assistant, overal waar een apparaat met id en naam staat. */
function metEigenNamen<T>(data: T): T {
  const namen = instellingen().namen;
  if (!Object.keys(namen).length) return data;
  // Een kopie, want de voorbeeldgegevens zijn vaste objecten die niet blijvend mogen veranderen.
  const kopie = structuredClone(data);
  const loop = (w: unknown): void => {
    if (Array.isArray(w)) w.forEach(loop);
    else if (w && typeof w === 'object') {
      const o = w as Record<string, unknown>;
      if (typeof o.id === 'string' && typeof o.naam === 'string' && namen[o.id]) o.naam = namen[o.id];
      Object.values(o).forEach(loop);
    }
  };
  loop(kopie);
  return kopie;
}

// Alleen gewone entiteitnamen van het juiste soort komen door naar Home Assistant.
const entiteit = (soort: string, waarde: string) => (new RegExp(`^${soort}\\.[a-z0-9_]+$`).test(waarde) ? waarde : null);

const meldingen = Meldingen.uitOmgeving(huis, app.log);

const apps = new Apps(meldingen, app.log);

const aanwezig = new Aanwezig(huis instanceof HomeAssistant ? huis : null, app.log);
aanwezig.start();
meldingen.isWeg = () => aanwezig.weg;

const google = Google.uitOmgeving();
app.log.info(google ? 'Google-client ingesteld.' : 'Geen GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET ingesteld, agenda en mail tonen voorbeeldgegevens.');

app.get('/api/overzicht', async () => {
  const status = { ingesteld: !!google, gekoppeld: !!google?.gekoppeld };
  if (!google?.gekoppeld) return { ...voorbeeld, voorbeeld: true, google: status };
  // Agenda en mail apart, zodat een fout in de een de ander niet meeneemt.
  const [afspraken, post] = await Promise.allSettled([google.afspraken(), google.mail()]);
  for (const r of [afspraken, post]) if (r.status === 'rejected') app.log.warn(r.reason);
  return {
    voorbeeld: false,
    google: status,
    weer: voorbeeld.weer,
    agenda: afspraken.status === 'fulfilled' ? afspraken.value.vandaag : [],
    morgen: afspraken.status === 'fulfilled' ? afspraken.value.morgen : '',
    agendaFout: afspraken.status === 'rejected',
    mail: post.status === 'fulfilled' ? post.value.mail : [],
    mailAantal: post.status === 'fulfilled' ? post.value.aantal : 0,
    mailFout: post.status === 'rejected',
  };
});

app.get('/api/instellingen', async () => instellingen());

app.put('/api/instellingen', async (request, reply) => {
  const fout = zetInstellingen(request.body);
  if (fout) return reply.code(400).send({ fout });
  return instellingen();
});

app.get('/api/google', async () => {
  if (!google) return { ingesteld: false, gekoppeld: false, agendas: [] };
  const agendas = google.gekoppeld ? await google.agendas().catch(() => []) : [];
  return { ingesteld: true, gekoppeld: google.gekoppeld, agendas };
});

app.post('/api/google/start', async (_request, reply) => {
  if (!google) return reply.code(400).send({ fout: 'Google is nog niet ingesteld op de server' });
  return { adres: google.koppelAdres() };
});

app.post<{ Body: { adres?: unknown } }>('/api/google/koppel', async (request, reply) => {
  if (!google) return reply.code(400).send({ fout: 'Google is nog niet ingesteld op de server' });
  if (typeof request.body?.adres !== 'string') return reply.code(400).send({ fout: 'Plak het adres uit je browser' });
  try {
    await google.koppel(request.body.adres);
    return { ok: true };
  } catch (fout) {
    return reply.code(400).send({ fout: (fout as Error).message });
  }
});

app.delete('/api/google', async () => {
  google?.ontkoppel();
  return { ok: true };
});

app.post<{ Body: { id?: unknown; aan?: unknown } }>('/api/google/agenda', async (request, reply) => {
  const { id, aan } = request.body ?? {};
  if (!google?.gekoppeld || typeof id !== 'string' || typeof aan !== 'boolean') return reply.code(400).send({ fout: 'Onbekende agenda' });
  if (!(await google.agendas()).some((a) => a.id === id)) return reply.code(404).send({ fout: 'Onbekende agenda' });
  google.zetAgenda(id, aan);
  return { ok: true };
});

app.get<{ Querystring: { na?: string } }>('/api/meldingen', async (request) => {
  const na = Number.parseInt(request.query.na ?? '', 10);
  return meldingen.sinds(Number.isNaN(na) ? null : na);
});

app.get('/api/meldingen/opties', async () => {
  const [cameras, toestellen, details] = await Promise.allSettled([meldingen.frigateCameras(), huis.toestellen(), meldingen.frigateDetails()]);
  return {
    frigate: { ingesteld: meldingen.ingesteld, bereikbaar: cameras.status === 'fulfilled' && meldingen.ingesteld },
    cameras: cameras.status === 'fulfilled' ? cameras.value : [],
    toestellen: toestellen.status === 'fulfilled' ? toestellen.value : [],
    zones: details.status === 'fulfilled' ? details.value.zones : [],
    gezichten: details.status === 'fulfilled' ? details.value.gezichten : [],
    soorten: SOORTEN,
  };
});

app.get('/api/meldingen/vandaag', async (_request, reply) => {
  try {
    return { frigate: meldingen.ingesteld, lijst: (await meldingen.vandaag()) ?? [] };
  } catch (fout) {
    app.log.warn(fout);
    return reply.code(502).send({ fout: 'Frigate is niet bereikbaar' });
  }
});

app.post('/api/meldingen/test', async () => ({ telefoon: await meldingen.test() }));

app.get<{ Params: { camera: string } }>('/api/meldingen/camera/:camera/beeld', async (request, reply) => {
  const beeld = await meldingen.cameraBeeld(request.params.camera).catch(() => null);
  if (!beeld) return reply.code(404).send({ fout: 'Geen beeld' });
  return reply.header('cache-control', 'no-store').type(beeld.type).send(beeld.data);
});

app.get('/api/opnames', async (_request, reply) => {
  try {
    return await meldingen.opnames();
  } catch (fout) {
    app.log.warn(fout);
    return reply.code(502).send({ fout: 'Frigate is niet bereikbaar' });
  }
});

app.get<{ Params: { id: string } }>('/api/meldingen/:id/video', async (request, reply) => {
  const video = await meldingen.video(request.params.id, request.headers.range).catch(() => null);
  if (!video) return reply.code(404).send({ fout: 'Geen opname' });
  reply.code(video.status);
  for (const kop of ['content-type', 'content-length', 'content-range', 'accept-ranges'])
    if (video.headers.get(kop)) reply.header(kop, video.headers.get(kop)!);
  return reply.send(Readable.fromWeb(video.body as import('node:stream/web').ReadableStream));
});

app.get<{ Params: { id: string } }>('/api/meldingen/:id/beeld', async (request, reply) => {
  const beeld = await meldingen.beeld(request.params.id).catch(() => null);
  if (!beeld) return reply.code(404).send({ fout: 'Geen beeld' });
  return reply.header('cache-control', 'max-age=3600').type(beeld.type).send(beeld.data);
});

app.get('/api/apps', async () => apps.alles());

app.get('/api/versie', async () => versie());

app.get<{ Params: { id: string } }>('/api/apps/jellyfin/beeld/:id', async (request, reply) => {
  const beeld = await apps.jellyfinBeeld(request.params.id).catch(() => null);
  if (!beeld) return reply.code(404).send({ fout: 'Geen beeld' });
  return reply.header('cache-control', 'max-age=86400').type(beeld.type).send(beeld.data);
});

app.get('/api/apparaten', async (_request, reply) => {
  try {
    return metEigenNamen(await huis.apparaten());
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

app.post<{ Params: { id: string }; Body: { aan?: unknown } }>('/api/apparaat/:id', async (request, reply) => {
  const id = entiteit(`(?:${BEDIENBAAR.join('|')})`, request.params.id);
  if (!id || typeof request.body?.aan !== 'boolean') return reply.code(400).send({ fout: 'Dit apparaat kan Atlas niet bedienen' });
  if (!(await huis.bestaat(id))) return reply.code(404).send({ fout: 'Apparaat niet gevonden' });
  await huis.bedien(id, request.body.aan);
  return { ok: true };
});

app.get('/api/energie', async (_request, reply) => {
  try {
    return await huis.energie();
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

// Vertrekhulp: wanneer weg voor de volgende afspraak, en of het regent.
app.get('/api/vertrek', async () => {
  let afspraken = voorbeeld.agenda.map((a) => {
    // In het voorbeeld: de afspraken staan vandaag op hun tijd, en Sporten is een plek.
    const [u, m] = a.tijd.split(':').map(Number);
    const begin = new Date(middernacht().getTime() + (u * 60 + m) * 60_000);
    return { ...a, kleur: null, begin: begin.toISOString(), plek: a.titel === 'Sporten' ? 'Sportschool Heiloo' : undefined };
  });
  if (google?.gekoppeld) afspraken = (await google.afspraken().catch(() => ({ vandaag: [] }))).vandaag as typeof afspraken;
  return { vertrek: volgendeVertrek(afspraken), regen: await regen() };
});

// Opnames voor de eigen Whisper-server komen binnen als ruwe audio, hooguit 5 MB (ruim een minuut).
app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_request, body, klaar) => klaar(null, body));
app.get('/api/spraak', async () => ({ aan: spraakAan() }));
app.post('/api/spraak', async (request, reply) => {
  if (!spraakAan()) return reply.code(404).send({ fout: 'Spraak op de server staat niet aan' });
  const type = String(request.headers['content-type'] ?? '');
  if (!Buffer.isBuffer(request.body) || !type.startsWith('audio/')) return reply.code(400).send({ fout: 'Geen opname' });
  try {
    return { tekst: await naarTekst(request.body, type.split(';')[0]) };
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'De spraakserver is niet bereikbaar' });
  }
});

// Controlescherm: wat Atlas allemaal vindt, zodat je thuis in één oogopslag ziet wat werkt en wat nog moet.
type Controle = { naam: string; staat: 'goed' | 'let-op' | 'uit'; tekst: string };
app.get('/api/status', async () => {
  const inst = instellingen();
  const [h, e, a, frigate, spraak, buien, ai] = await Promise.allSettled([
    huis.huis(),
    huis.energie(),
    huis.afval(),
    meldingen.frigateCameras(),
    spraakBereikbaar(),
    regen(),
    aiBereikbaar(),
  ]);
  const lijst: Controle[] = [];
  const echt = !!ha;
  if (!echt) lijst.push({ naam: 'Home Assistant', staat: 'uit', tekst: 'Niet ingesteld: vul HA_URL en HA_TOKEN in. Nu zie je het voorbeeldhuis.' });
  else if (h.status === 'rejected') lijst.push({ naam: 'Home Assistant', staat: 'let-op', tekst: `Niet bereikbaar op ${ha.url}. Klopt het adres en de toegangscode?` });
  else {
    const lampen = h.value.kamers.reduce((n, k) => n + k.lampen.length, 0) + h.value.losseLampen.length;
    lijst.push({ naam: 'Home Assistant', staat: 'goed', tekst: `${h.value.kamers.length} ruimtes, ${lampen} lampen, ${h.value.cameras.length} camera's, ${h.value.scenes.length} scènes` });
  }
  if (echt) {
    const p = aanwezig.personen;
    lijst.push(
      p.length
        ? { naam: 'Personen', staat: 'goed', tekst: p.map((x) => `${x.naam} (${x.thuis ? 'thuis' : 'weg'})`).join(', ') }
        : { naam: 'Personen', staat: 'let-op', tekst: 'Geen personen gevonden; nodig voor Thuis en weg.' },
    );
  }
  if (e.status === 'fulfilled') {
    const v = e.value;
    const gevonden = [v.vermogen != null && 'vermogen nu', v.vandaag.stroom != null && 'stroom', v.vandaag.terug != null && 'teruglevering', v.vandaag.gas != null && 'gas', v.vandaag.opwek != null && 'zon', v.thermostaat && 'thermostaat'].filter(Boolean);
    lijst.push({
      naam: 'Energie en klimaat',
      staat: gevonden.length || v.kamers.length ? 'goed' : 'let-op',
      tekst: gevonden.length || v.kamers.length ? `${gevonden.join(', ') || 'geen meters'}; klimaat in ${v.kamers.length} ruimtes` : 'Geen meters of sensoren gevonden.',
    });
  }
  if (a.status === 'fulfilled')
    lijst.push(
      a.value.length
        ? { naam: 'Afvalkalender', staat: 'goed', tekst: a.value.slice(0, 3).map((x) => `${x.naam} ${x.datum.slice(8, 10)}-${x.datum.slice(5, 7)}`).join(', ') }
        : { naam: 'Afvalkalender', staat: 'let-op', tekst: 'Geen afvalsensoren; installeer Afvalwijzer (HVC) in Home Assistant.' },
    );
  lijst.push(
    !meldingen.ingesteld
      ? { naam: 'Frigate', staat: 'uit', tekst: 'Niet gevonden op poort 5000; vul eventueel FRIGATE_URL in.' }
      : frigate.status === 'fulfilled'
        ? { naam: 'Frigate', staat: 'goed', tekst: `${frigate.value.length} camera's` }
        : { naam: 'Frigate', staat: 'let-op', tekst: 'Gevonden maar reageert niet.' },
  );
  lijst.push({
    naam: 'Meldingen op de telefoon',
    staat: inst.meldingen.telefoon && inst.meldingen.toestel ? 'goed' : 'uit',
    tekst: inst.meldingen.telefoon && inst.meldingen.toestel ? inst.meldingen.toestel.replace('mobile_app_', '').replace(/_/g, ' ') : 'Uit, of geen telefoon gekozen (tandwiel › Meldingen).',
  });
  lijst.push(
    !google
      ? { naam: 'Google', staat: 'uit', tekst: 'Niet ingesteld: agenda en mail zijn voorbeeld.' }
      : google.gekoppeld
        ? { naam: 'Google', staat: 'goed', tekst: 'Agenda en mail gekoppeld' }
        : { naam: 'Google', staat: 'let-op', tekst: 'Ingesteld maar nog niet gekoppeld (hieronder).' },
  );
  const spraakOk = spraak.status === 'fulfilled' ? spraak.value : false;
  lijst.push(
    spraakOk === null
      ? { naam: 'Spraak (Whisper)', staat: 'uit', tekst: 'Geen WHISPER_URL: spraak via de browser, niet in de Windows-app.' }
      : spraakOk
        ? { naam: 'Spraak (Whisper)', staat: 'goed', tekst: 'Bereikbaar' }
        : { naam: 'Spraak (Whisper)', staat: 'let-op', tekst: 'WHISPER_URL ingesteld, maar de server antwoordt niet.' },
  );
  lijst.push(
    buien.status === 'fulfilled' && buien.value
      ? { naam: 'Regen (Buienradar)', staat: 'goed', tekst: buien.value.tekst }
      : { naam: 'Regen (Buienradar)', staat: 'let-op', tekst: 'Niet bereikbaar vanaf de server.' },
  );
  const aiOk = ai.status === 'fulfilled' ? ai.value : false;
  lijst.push(
    aiOk === null
      ? { naam: 'Lokale AI (Ollama)', staat: 'uit', tekst: 'Geen OLLAMA_URL: de opdrachtbalk kent alleen vaste zinnen.' }
      : aiOk
        ? { naam: 'Lokale AI (Ollama)', staat: 'goed', tekst: 'Helpt bij zinnen die de opdrachtbalk niet kent' }
        : { naam: 'Lokale AI (Ollama)', staat: 'let-op', tekst: 'OLLAMA_URL ingesteld, maar Ollama antwoordt niet.' },
  );
  return { lijst };
});

app.get('/api/aanwezig', async () => aanwezig.status());

app.get('/api/afval', async (_request, reply) => {
  try {
    return { lijst: await huis.afval() };
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

// Een opdracht in gewone taal uit de opdrachtbalk of de spraakbol.
app.post<{ Body: { tekst?: unknown } }>('/api/opdracht', async (request, reply) => {
  const tekst = request.body?.tekst;
  if (typeof tekst !== 'string' || tekst.length > 200) return reply.code(400).send({ fout: 'Geen opdracht' });
  try {
    return await voerUit(tekst, {
      huis: async () => metEigenNamen(await huis.huis()),
      apparaten: async () => metEigenNamen(await huis.apparaten()),
      energie: () => huis.energie(),
      lamp: (id, opdracht) => huis.lamp(id, opdracht),
      bedien: (id, aan) => huis.bedien(id, aan),
      scene: (id) => huis.scene(id),
      hulp: herschrijf,
    });
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

app.get('/api/huis', async (_request, reply) => {
  try {
    return metEigenNamen(await huis.huis());
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

// Lamp aan of uit ({aan}), dimmen ({helderheid: 1-100}) of warmer/koeler wit ({kelvin}).
app.post<{ Params: { id: string }; Body: { aan?: unknown; helderheid?: unknown; kelvin?: unknown } }>('/api/lamp/:id', async (request, reply) => {
  const id = entiteit('light', request.params.id);
  const { aan, helderheid, kelvin } = request.body ?? {};
  const geldig =
    (aan === undefined || typeof aan === 'boolean') &&
    (helderheid === undefined || (Number.isInteger(helderheid) && (helderheid as number) >= 1 && (helderheid as number) <= 100)) &&
    (kelvin === undefined || (Number.isInteger(kelvin) && (kelvin as number) >= 1000 && (kelvin as number) <= 10000)) &&
    (aan !== undefined || helderheid !== undefined || kelvin !== undefined);
  if (!id || !geldig) return reply.code(400).send({ fout: 'Onbekende lamp of opdracht' });
  if (!(await huis.bestaat(id))) return reply.code(404).send({ fout: 'Lamp niet gevonden' });
  await huis.lamp(id, { aan: aan as boolean | undefined, helderheid: helderheid as number | undefined, kelvin: kelvin as number | undefined });
  return { ok: true };
});

app.get<{ Params: { id: string } }>('/api/camera/:id/opties', async (request, reply) => {
  const id = entiteit('camera', request.params.id);
  if (!id) return reply.code(404).send({ fout: 'Camera niet gevonden' });
  try {
    return { opties: await huis.cameraOpties(id) };
  } catch (fout) {
    app.log.warn(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

// Eén instelling van een camera zetten. Alleen wat bij die camera hoort, en alleen geldige waarden.
app.post<{ Params: { id: string; optie: string }; Body: { waarde?: unknown } }>('/api/camera/:id/opties/:optie', async (request, reply) => {
  const id = entiteit('camera', request.params.id);
  const optie = id ? (await huis.cameraOpties(id)).find((o) => o.id === request.params.optie) : undefined;
  if (!optie) return reply.code(404).send({ fout: 'Deze instelling hoort niet bij de camera' });
  const w = request.body?.waarde;
  const geldig =
    optie.soort === 'button'
      ? true
      : optie.soort === 'select'
        ? typeof w === 'string' && !!optie.keuzes?.includes(w)
        : optie.soort === 'number'
          ? typeof w === 'number' && Number.isFinite(w) && w >= optie.min! && w <= optie.max!
          : typeof w === 'boolean';
  if (!geldig) return reply.code(400).send({ fout: 'Ongeldige waarde' });
  await huis.cameraOptie(optie, (w ?? null) as boolean | string | number | null);
  return { ok: true };
});

app.post<{ Params: { id: string } }>('/api/scene/:id', async (request, reply) => {
  const id = entiteit('scene', request.params.id);
  if (!id || !(await huis.bestaat(id))) return reply.code(404).send({ fout: 'Scène niet gevonden' });
  await huis.scene(id);
  return { ok: true };
});

app.get<{ Params: { id: string } }>('/api/camera/:id', async (request, reply) => {
  const id = entiteit('camera', request.params.id);
  if (!id) return reply.code(404).send({ fout: 'Camera niet gevonden' });
  try {
    const beeld = await huis.cameraBeeld(id);
    if (!beeld) return reply.code(404).send({ fout: 'Geen camerabeeld' });
    return reply.header('cache-control', 'no-store').type(beeld.type).send(beeld.data);
  } catch (fout) {
    app.log.warn(fout);
    return reply.code(502).send({ fout: 'Camerabeeld niet beschikbaar' });
  }
});

if (existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ fout: 'Onbekend adres' });
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn(`Geen webbestanden gevonden in ${webDir}. Draai eerst "npm run build".`);
}

await app.listen({ host: '0.0.0.0', port });
