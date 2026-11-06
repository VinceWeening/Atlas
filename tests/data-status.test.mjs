import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleUrl = (name) => pathToFileURL(join(root, 'server/dist', `${name}.js`)).href;
async function start(scenario, t) {
  const data = mkdtempSync(join(tmpdir(), 'atlas-data-status-'));
  const env = { ...process.env, PORT: '0', DATA_DIR: data, WEB_DIR: join(data, 'no-web'), OLLAMA_URL: 'http://ollama.test', OLLAMA_MODEL: 'qwen2.5:3b' };
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'WHISPER_URL', 'HA_URL', 'HA_TOKEN', 'FRIGATE_URL']) delete env[name];
  if (scenario !== 'demo' && scenario !== 'google-only') Object.assign(env, { HA_URL: 'http://ha.test', HA_TOKEN: 'test-only' });
  const fixture = `
    globalThis.WebSocket = undefined;
    globalThis.fetch = async (url, init) => {
      const address = String(url);
      if (address === 'http://ollama.test/api/tags') return Response.json({ models: [{ name: 'qwen2.5:3b' }] });
      if (address === 'http://ollama.test/api/chat') {
        const input = JSON.parse(init.body);
        const system = input.messages[0].content;
        return Response.json({ message: { content: system.includes('Wat Atlas nu weet:') ? system.split('Wat Atlas nu weet:')[1] : 'ONBEKEND' } });
      }
      throw new Error('External request blocked by integration fixture');
    };
    const { HomeAssistant } = await import(${JSON.stringify(moduleUrl('ha'))});
    HomeAssistant.prototype.huis = async () => ({ bron: 'home-assistant', kamers: [], losseLampen: [], cameras: [], scenes: [], weer: null, binnen: null });
    HomeAssistant.prototype.energie = async () => ({ bron: 'home-assistant', vermogen: null, vandaag: {}, thermostaat: null, kamers: [] });
    HomeAssistant.prototype.afval = async () => [];
    HomeAssistant.prototype.personen = async () => [];
    HomeAssistant.prototype.apparaten = async () => ({ ruimtes: [], overig: [] });
    const { Google } = await import(${JSON.stringify(moduleUrl('google'))});
    const scenario = ${JSON.stringify(scenario)};
    Google.uitOmgeving = () => scenario === 'unconfigured' || scenario === 'demo' ? null : {
      gekoppeld: scenario !== 'uncoupled',
      afspraken: async () => {
        if (scenario === 'failure') throw new Error('Calendar unavailable');
        return { vandaag: [{ tijd: '15:00', titel: 'Echte afspraak', detail: '', kleur: null }], morgen: 'Echte afspraak morgen' };
      },
      mail: async () => ({ mail: [], aantal: 0 }),
    };
    await import(${JSON.stringify(moduleUrl('index'))});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', fixture], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
  const exited = new Promise((done) => child.once('exit', done));
  t.after(async () => {
    child.kill(); await exited;
    assert.equal(dirname(resolve(data)), resolve(tmpdir()));
    rmSync(data, { recursive: true, force: true });
  });
  const origin = await new Promise((done, fail) => {
    const timeout = setTimeout(() => fail(new Error('Server startup timed out: ' + output)), 10000);
    child.once('error', (error) => { clearTimeout(timeout); fail(error); });
    child.once('exit', (code) => { clearTimeout(timeout); fail(new Error('Server exited ' + code + ': ' + output)); });
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-12000);
      const port = output.match(/Server listening at http:\/\/[^:"\\]+:(\d+)/)?.[1];
      if (port) { clearTimeout(timeout); done('http://127.0.0.1:' + port); }
    });
  });
  return async (path, body) => {
    const response = await fetch(origin + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    assert.equal(response.status, 200, output);
    return response.json();
  };
}
for (const scenario of ['unconfigured', 'uncoupled']) {
  test(`echt huis en Google ${scenario}: geen voorbeeldagenda, mail of vertrek`, async (t) => {
    const api = await start(scenario, t);
    const overview = await api('/api/overzicht');
    assert.equal(overview.voorbeeld, false);
    assert.equal(overview.google.gekoppeld, false);
    assert.equal(overview.google.ingesteld, scenario === 'uncoupled');
    assert.deepEqual(overview.agenda, []);
    assert.deepEqual(overview.mail, []);
    assert.equal(overview.morgen, '');
    assert.equal(overview.weer.temperatuur, null);
    const departure = await api('/api/vertrek');
    assert.equal(departure.vertrek, null);
    assert.equal(departure.agendaBeschikbaar, false);
    const answer = await api('/api/opdracht', { tekst: 'Wat staat er vandaag nog?' });
    assert.equal(answer.ai, true);
    assert.match(answer.tekst, /Google is niet gekoppeld/);
    assert.doesNotMatch(answer.tekst, /Sporten|Bol.com|Eten bij ouders|Agenda vandaag: niets|Belangrijke mail: 0/);
  });
}
test('gekoppelde Google toont echte data zonder verzonnen weer', async (t) => {
  const api = await start('coupled', t);
  const overview = await api('/api/overzicht');
  assert.equal(overview.voorbeeld, false);
  assert.equal(overview.google.gekoppeld, true);
  assert.equal(overview.agenda[0].titel, 'Echte afspraak');
  assert.equal(overview.agendaFout, false);
  assert.equal(overview.weer.temperatuur, null);
});
test('Google-agendastoring blijft onbekend in vertrek en AI', async (t) => {
  const api = await start('failure', t);
  const overview = await api('/api/overzicht');
  assert.equal(overview.agendaFout, true);
  assert.equal(overview.mailFout, false);
  const departure = await api('/api/vertrek');
  assert.equal(departure.vertrek, null);
  assert.equal(departure.agendaFout, true);
  const answer = await api('/api/opdracht', { tekst: 'Wat staat er vandaag nog?' });
  assert.match(answer.tekst, /Agenda vandaag: tijdelijk niet bereikbaar/);
  assert.doesNotMatch(answer.tekst, /Agenda vandaag: niets|Sporten|Eten bij ouders/);
});
test('volledige demo blijft herkenbaar en coherent', async (t) => {
  const api = await start('demo', t);
  const overview = await api('/api/overzicht');
  assert.equal(overview.voorbeeld, true);
  assert.ok(overview.agenda.length > 0);
  assert.ok(overview.mail.length > 0);
  const departure = await api('/api/vertrek');
  assert.equal(departure.voorbeeld, true);
  const answer = await api('/api/opdracht', { tekst: 'Wat staat er vandaag nog?' });
  assert.match(answer.tekst, /Demostand/);
  assert.match(answer.tekst, /uitsluitend voorbeelden/);
});

test('alleen Google gekoppeld: echte afspraken en expliciet voorbeeldhuis', async (t) => {
  const api = await start('google-only', t);
  const overview = await api('/api/overzicht');
  assert.equal(overview.voorbeeld, false);
  assert.equal(overview.agenda[0].titel, 'Echte afspraak');
  const house = await api('/api/huis');
  assert.equal(house.bron, 'voorbeeld');
  const answer = await api('/api/opdracht', { tekst: 'Wat staat er vandaag nog?' });
  assert.match(answer.tekst, /alleen de gekoppelde Google-agenda en mail zijn echt/);
});
