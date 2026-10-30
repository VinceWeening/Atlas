import { test } from 'node:test';
import assert from 'node:assert/strict';

const { voerUit } = await import('../server/dist/opdracht.js');

// Een klein nephuis: opdrachten moeten iets doen, vragen moeten bij de AI uitkomen.
const lamp = (id, naam, aan = false) => ({ id, naam, aan, bereikbaar: true, dimbaar: true });
const huis = {
  kamers: [
    { naam: 'Woonkamer', temperatuur: 20, lampen: [lamp('l1', 'Plafond woonkamer', true)] },
    { naam: 'Keuken', lampen: [lamp('l2', 'Keukenlamp')] },
  ],
  losseLampen: [],
  scenes: [{ id: 's1', naam: 'Filmavond' }],
  binnen: 20,
  weer: { temperatuur: 9 },
};
function bron(extra = {}) {
  const gedaan = [];
  return {
    gedaan,
    huis: async () => huis,
    apparaten: async () => ({ ruimtes: [], overig: [] }),
    energie: async () => ({ vermogen: 300, vandaag: { stroom: 4, gas: null } }),
    lamp: async (id, o) => gedaan.push(`${id} ${o.aan === false ? 'uit' : 'aan'}`),
    bedien: async () => {},
    scene: async (id) => gedaan.push(id),
    hulp: async () => null,
    vraag: async (zin) => ({ tekst: `AI: ${zin}`, bron: 'claude' }),
    ...extra,
  };
}

test('opdrachten blijven werken, ook tijdens een gesprek', async () => {
  for (const [zin, verwacht, extra] of [['woonkamer uit', 'l1 uit'], ['keuken aan', 'l2 aan', { gesprek: true }], ['filmavond', 's1']]) {
    const b = bron(extra);
    const a = await voerUit(zin, b);
    assert.equal(a.gedaan, true, zin);
    assert.deepEqual(b.gedaan, [verwacht], zin);
    assert.ok(!a.ai, zin);
  }
});

test('vragen over het huis beantwoordt Atlas zelf', async () => {
  assert.equal((await voerUit('hoe warm is het in de woonkamer', bron())).tekst, 'In Woonkamer is het 20 graden.');
  assert.match((await voerUit('hoeveel stroom gebruiken we', bron())).tekst, /300 watt/);
});

test('algemene vragen en vervolgvragen gaan naar de AI', async () => {
  for (const [zin, extra] of [
    ['hoe warm is de zon'],
    ['hoeveel stroom kost een waterkoker'],
    ['wie is de premier van Nederland'],
    ['leg uit hoe een warmtepomp werkt'],
    ['vertel een mop over de keuken'],
    ['wat is 20 procent van 80'],
    ['en morgen', { gesprek: true }],
  ]) {
    const b = bron(extra);
    const a = await voerUit(zin, b);
    assert.equal(a.ai, true, zin);
    assert.equal(a.bron, 'claude', zin);
    assert.deepEqual(b.gedaan, [], zin);
  }
});

test('zonder AI blijft het bij de vaste zinnen', async () => {
  const a = await voerUit('wie is de premier van Nederland', bron({ hulp: undefined, vraag: undefined }));
  assert.ok(!a.ai);
  assert.match(a.tekst, /^Dat snap ik nog niet/);
});
