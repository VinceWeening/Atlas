import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Kleine JSON-bestanden in de datamap (in Docker een eigen volume), zodat koppelingen en instellingen een herstart overleven.
export const map = process.env.DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(map, { recursive: true });

export function lees<T>(naam: string, standaard: T): T {
  try {
    return { ...standaard, ...JSON.parse(readFileSync(join(map, `${naam}.json`), 'utf8')) };
  } catch {
    return standaard;
  }
}

export function bewaar(naam: string, waarde: unknown) {
  // Eerst naar een tijdelijk bestand en dan hernoemen, zodat een half geschreven bestand nooit blijft staan.
  const pad = join(map, `${naam}.json`);
  writeFileSync(`${pad}.tmp`, JSON.stringify(waarde, null, 2), { mode: 0o600 });
  renameSync(`${pad}.tmp`, pad);
}
