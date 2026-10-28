import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { HomeAssistant, haInstellingen } from './ha.js';
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

app.get('/api/overzicht', async () => ({ ...voorbeeld, voorbeeld: true }));

app.get('/api/huis', async (_request, reply) => {
  try {
    return await huis.huis();
  } catch (fout) {
    app.log.error(fout);
    return reply.code(502).send({ fout: 'Home Assistant is niet bereikbaar' });
  }
});

app.post<{ Params: { id: string }; Body: { aan?: unknown } }>('/api/lamp/:id', async (request, reply) => {
  const id = entiteit('light', request.params.id);
  if (!id || typeof request.body?.aan !== 'boolean') return reply.code(400).send({ fout: 'Onbekende lamp of opdracht' });
  if (!(await huis.bestaat(id))) return reply.code(404).send({ fout: 'Lamp niet gevonden' });
  await huis.lamp(id, request.body.aan);
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
