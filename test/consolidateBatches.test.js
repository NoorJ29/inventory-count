const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCounts, resetCounts, appendCounts, consolidateBatches } = require('../src/db/cloudflare');

// A minimal in-memory stand-in for the Workers KV binding — just enough of
// get/put/delete/list (with cursor-based pagination, since listKeysWithPrefix
// relies on it) to exercise the real cloudflare.js logic without needing an
// actual Cloudflare account.
function makeFakeKv({ pageSize = 1000 } = {}) {
  const store = new Map();
  return {
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts && opts.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix, cursor }) {
      const allKeys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = allKeys.slice(start, start + pageSize);
      const listComplete = start + pageSize >= allKeys.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: listComplete,
        cursor: listComplete ? undefined : String(start + pageSize),
      };
    },
    _size: () => store.size,
  };
}

function record(overrides) {
  return {
    date: '2026-07-10',
    person: 'Romain',
    location: 'Chiller 1',
    itemCode: 'ADIGIND009',
    description: 'UTD 43 GIN 750ML',
    uom: 'UNIT',
    quantity: 10,
    expiryDate: '',
    theoreticalInventory: 10,
    unitCost: 5,
    difference: 0,
    differenceCost: 0,
    ...overrides,
  };
}

test('consolidateBatches merges multiple batch- keys into one archive- key with all records, deleting the originals', async () => {
  const kv = makeFakeKv();
  await appendCounts(kv, [record({ itemCode: 'A' })]);
  await appendCounts(kv, [record({ itemCode: 'B' })]);
  await appendCounts(kv, [record({ itemCode: 'C' })]);

  const beforeRows = await loadCounts(kv);
  assert.equal(beforeRows.length, 3);

  await consolidateBatches(kv);

  const keys = [...(await kv.list({ prefix: '' })).keys.map((k) => k.name)];
  const batchKeys = keys.filter((k) => k.startsWith('batch-'));
  const archiveKeys = keys.filter((k) => k.startsWith('archive-'));
  assert.equal(batchKeys.length, 0);
  assert.equal(archiveKeys.length, 1);
});

test('loadCounts returns identical, correctly-sorted data whether records are in batch- keys, archive- keys, or a mix', async () => {
  const kv = makeFakeKv();
  await appendCounts(kv, [record({ itemCode: 'A', quantity: 1 })]);
  await appendCounts(kv, [record({ itemCode: 'B', quantity: 2 })]);
  const beforeRows = await loadCounts(kv);

  await consolidateBatches(kv); // both existing rows move into one archive- key

  await appendCounts(kv, [record({ itemCode: 'C', quantity: 3 })]); // a new batch- key alongside the archive

  const afterRows = await loadCounts(kv);
  assert.equal(afterRows.length, 3);
  assert.deepEqual(
    afterRows.map((r) => r.itemCode).sort(),
    ['A', 'B', 'C']
  );
  // Sorted ascending by timestamp either way.
  for (let i = 1; i < afterRows.length; i++) {
    assert.ok(afterRows[i - 1].timestamp <= afterRows[i].timestamp);
  }
  assert.equal(beforeRows.length, 2);
});

test('resetCounts clears both batch- and archive- keys', async () => {
  const kv = makeFakeKv();
  await appendCounts(kv, [record({ itemCode: 'A' })]);
  await consolidateBatches(kv); // now sitting in an archive- key
  await appendCounts(kv, [record({ itemCode: 'B' })]); // a fresh batch- key too

  assert.equal((await loadCounts(kv)).length, 2);

  await resetCounts(kv);

  assert.equal((await loadCounts(kv)).length, 0);
  const remainingKeys = (await kv.list({ prefix: '' })).keys;
  assert.equal(remainingKeys.length, 0);
});

test('consolidateBatches processes at most CONSOLIDATE_CHUNK_SIZE (500) keys per run, leaving the rest for next time', async () => {
  const kv = makeFakeKv();
  for (let i = 0; i < 600; i++) {
    await appendCounts(kv, [record({ itemCode: `ITEM${i}` })]);
  }
  assert.equal((await loadCounts(kv)).length, 600);

  await consolidateBatches(kv);

  const keysAfterFirstRun = (await kv.list({ prefix: '' })).keys.map((k) => k.name);
  const remainingBatches = keysAfterFirstRun.filter((k) => k.startsWith('batch-'));
  const archives = keysAfterFirstRun.filter((k) => k.startsWith('archive-'));
  assert.equal(remainingBatches.length, 100); // 600 - 500 left un-consolidated
  assert.equal(archives.length, 1);
  // Data itself is never lost regardless of how many runs it takes.
  assert.equal((await loadCounts(kv)).length, 600);

  await consolidateBatches(kv); // second run catches up the remaining 100

  const keysAfterSecondRun = (await kv.list({ prefix: '' })).keys.map((k) => k.name);
  assert.equal(keysAfterSecondRun.filter((k) => k.startsWith('batch-')).length, 0);
  assert.equal(keysAfterSecondRun.filter((k) => k.startsWith('archive-')).length, 2);
  assert.equal((await loadCounts(kv)).length, 600);
});

test('consolidateBatches is a no-op when there are no pending batch- keys', async () => {
  const kv = makeFakeKv();
  await consolidateBatches(kv); // should not throw
  assert.equal((await loadCounts(kv)).length, 0);
});
