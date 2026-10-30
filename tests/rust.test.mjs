import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const map = mkdtempSync(join(tmpdir(), 'atlas-rust-test-'));
process.env.DATA_DIR = map;
writeFileSync(join(map, 'instellingen.json'), JSON.stringify({
  meldingen: { pc: false, telefoon: true, toestel: 'mobile_app_test', wachttijd: 10 },
  blokken: { camera: false }, ingevouwen: ['energie'],
}));
const { instellingen, zetInstellingen, nuIn } = await import('../server/dist/instellingen.js');
const { meldingKanalen } = await import('../server/dist/meldbeleid.js');
const basis = structuredClone(instellingen());
after(() => {
  assert.equal(dirname(resolve(map)), resolve(tmpdir()));
  assert.ok(map.includes('atlas-rust-test-'));
  rmSync(map, { recursive: true });
});

test('oude instellingen houden hun kanalen en blokkeuzes bij uitbreiding', () => {
  assert.equal(basis.meldingen.pc, false);
  assert.equal(basis.meldingen.popup, false);
  assert.equal(basis.meldingen.telefoon, true);
  assert.equal(basis.meldingen.wachttijd, 10);
  assert.equal(basis.blokken.camera, false);
  assert.deepEqual(basis.ingevouwen, ['energie']);
  assert.deepEqual(basis.weergave, { rustig: true, beweging: false, agendaAantal: 3, mailAantal: 3 });
});

test('ongeldige instellingen worden atomair geweigerd', () => {
  const voor = structuredClone(instellingen());
  for (const wijziging of [
    { weergave: { rustig: false, mailAantal: 500 } },
    { weergave: { beweging: 'ja' } },
    { meldingen: { popup: 'ja' } },
    { meldingen: { duur: 999 } },
    { meldingen: { pauzeTot: Number.MAX_SAFE_INTEGER } },
    { meldingen: { pauzeTot: -1 } },
  ]) {
    assert.equal(typeof zetInstellingen(wijziging), 'string');
    assert.deepEqual(instellingen(), voor);
  }
});

test('gedeeltelijke wijzigingen worden bewaard zonder andere voorkeuren te wissen', () => {
  assert.equal(zetInstellingen({ weergave: { mailAantal: 1 }, meldingen: { popup: false, duur: 4 } }), null);
  const bewaard = JSON.parse(readFileSync(join(map, 'instellingen.json'), 'utf8'));
  assert.equal(bewaard.weergave.mailAantal, 1);
  assert.equal(bewaard.weergave.agendaAantal, 3);
  assert.equal(bewaard.meldingen.pc, false);
  assert.equal(bewaard.meldingen.popup, false);
  assert.equal(bewaard.blokken.camera, false);
});

const nu = new Date('2026-10-30T22:30:00Z'); // 23:30 in Nederland
const alleKanalen = () => {
  const i = structuredClone(basis);
  Object.assign(i.meldingen, { pc: true, popup: true, telefoon: true, pauzeTot: 0 });
  return i;
};

test('stille uren over middernacht onderdrukken alle kanalen', () => {
  const i = alleKanalen();
  i.meldingen.stil = { aan: true, van: '23:00', tot: '07:00' };
  assert.deepEqual(meldingKanalen(i, true, false, nu), { stil: true, pc: false, popup: false, telefoon: false });
  assert.equal(nuIn(i.meldingen.stil, new Date('2026-10-31T06:00:00Z')), false);
});

test('pauze stopt alle kanalen en eindigt exact op de ingestelde tijd', () => {
  const i = alleKanalen();
  i.meldingen.pauzeTot = nu.getTime() + 60_000;
  assert.deepEqual(meldingKanalen(i, true, false, nu), { stil: true, pc: false, popup: false, telefoon: false });
  assert.deepEqual(meldingKanalen(i, true, false, new Date(i.meldingen.pauzeTot)), { stil: false, pc: true, popup: true, telefoon: true });
});

test('kanalen zijn onafhankelijk; expliciete test omzeilt stilte maar geen uitgeschakeld kanaal', () => {
  const i = alleKanalen();
  Object.assign(i.meldingen, { pc: false, popup: true, pauzeTot: nu.getTime() + 60_000 });
  assert.deepEqual(meldingKanalen(i, false, true, nu), { stil: false, pc: false, popup: true, telefoon: true });
});

test('alleen weg beïnvloedt telefoon en onbekende aanwezigheid blijft expliciet toegestaan', () => {
  const i = alleKanalen();
  i.weg = { aan: true, alleenWeg: true, allesUit: true };
  assert.equal(meldingKanalen(i, false, false, nu).telefoon, false);
  assert.equal(meldingKanalen(i, false, false, nu).popup, true);
  assert.equal(meldingKanalen(i, null, false, nu).telefoon, true);
  i.meldingen.telefoon = false;
  assert.equal(meldingKanalen(i, true, false, nu).telefoon, false);
});

test('de echte Alles uit?-route respecteert uitgeschakelde telefoon en pauze', async () => {
  const { Aanwezig } = await import('../server/dist/aanwezig.js');
  let verstuurd = 0;
  const aanwezig = new Aanwezig({ lampenAan: async () => ['light.test'], melding: async () => { verstuurd++; } }, { info() {}, warn() {} });
  assert.equal(zetInstellingen({ weg: { aan: true, allesUit: true }, meldingen: { telefoon: false, pauzeTot: 0 } }), null);
  await aanwezig.weggegaan();
  assert.equal(verstuurd, 0);
  assert.equal(zetInstellingen({ meldingen: { telefoon: true, pauzeTot: Date.now() + 60_000 } }), null);
  await aanwezig.weggegaan();
  assert.equal(verstuurd, 0);
  assert.equal(zetInstellingen({ meldingen: { pauzeTot: 0 } }), null);
  await aanwezig.weggegaan();
  assert.equal(verstuurd, 1);
});

test('al opgehaalde gebeurtenissen worden bij uitlezen onderdrukt na pauzeren en nooit opnieuw geactiveerd', async () => {
  const { Meldingen } = await import('../server/dist/meldingen.js');
  const m = new Meldingen({}, {}, { warn() {} });
  assert.equal(zetInstellingen({ meldingen: { pc: true, popup: true, telefoon: false, pauzeTot: 0 } }), null);
  await m.verstuur({ id: 'testevent', camera: 'deur', soort: 'person', titel: 'Persoon', tekst: 'Test', tijd: new Date().toISOString(), beeld: null });
  assert.equal(m.sinds(0).meldingen[0].pc, true);
  assert.equal(zetInstellingen({ meldingen: { pauzeTot: Date.now() + 60_000 } }), null);
  assert.equal(m.sinds(0).meldingen[0].pc, false);
  assert.equal(m.sinds(0).meldingen[0].popup, false);
  await m.verstuur({ id: 'stilevent', camera: 'deur', soort: 'person', titel: 'Persoon', tekst: 'Test', tijd: new Date().toISOString(), beeld: null });
  assert.equal(zetInstellingen({ meldingen: { pauzeTot: 0 } }), null);
  assert.equal(m.sinds(0).meldingen[1].pc, false);
  assert.equal(m.sinds(0).meldingen[1].popup, false);
});
