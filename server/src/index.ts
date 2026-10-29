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

// Alleen gewone entiteitnamen van het juiste soort komen door naar Home Assistant.
const entiteit = (soort: string, waarde: string) => (new RegExp(`^${soort}\\.[a-z0-9_]+$`).test(waarde) ? waarde : null);

const meldingen = Meldingen.uitOmgeving(huis, app.log);

const apps = new Apps(meldingen, app.log);

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
    return await huis.apparaten();
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

app.get('/api/huis', async (_request, reply) => {
  try {
    return await huis.huis();
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
