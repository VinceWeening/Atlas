import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { voorbeeld } from './voorbeeld.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(process.env.WEB_DIR ?? resolve(here, '../../web/dist'));
const port = Number(process.env.PORT ?? 8790);

const app = Fastify({ logger: true });

// De Windows-app controleert vanaf zijn eigen startpagina of de server bereikbaar is, dus deze route mag van elke herkomst.
app.get('/api/health', async (_request, reply) => {
  reply.header('access-control-allow-origin', '*');
  return { ok: true, naam: 'atlas', versie: process.env.ATLAS_VERSION ?? 'dev' };
});
app.get('/api/overzicht', async () => voorbeeld);

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
