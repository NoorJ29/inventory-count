const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCounts, appendCounts, deleteCounts, consolidateBatches } = require('../src/db/cloudflare');

// Same in-memory KV stand-in as consolidateBatches.test.js — see there for
// why this shape (get/put/delete/list with cursor pagination) is enough to
// exercise the real cloudflare.js logic without a real Cloudflare account.
function makeFakeKv() {
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
      const page = allKeys.slice(start, start + 1000);
      const listComplete = start + 1000 >= allKeys.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: listComplete,
        cursor: listComplete ? undefined : String(start + 1000),
      };
    },
    _keys: (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
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

async function idsOf(kv) {
  return (await loadCounts(kv)).map((r) => r.id);
}

test('deleting a subset of ids from a single batch removes only those, keeping the rest', async () => {
  const kv = makeFakeKv();
  const added = await appendCounts(kv, [record({ itemCode: 'A' }), record({ itemCode: 'B' }), record({ itemCode: 'C' })]);
  const [a, b, c] = added;

  const deleted = await deleteCounts(kv, [b.id]);
  assert.equal(deleted, 1);

  const remainingIds = await idsOf(kv);
  assert.deepEqual(remainingIds.sort(), [a.id, c.id].sort());
  // The batch key itself should still exist (not deleted), just rewritten.
  assert.equal(kv._keys('batch-').length, 1);
});

test('deleting every id in a batch removes the key entirely, not just empties it', async () => {
  const kv = makeFakeKv();
  const added = await appendCounts(kv, [record({ itemCode: 'A' }), record({ itemCode: 'B' })]);

  const deleted = await deleteCounts(kv, added.map((r) => r.id));
  assert.equal(deleted, 2);
  assert.equal(kv._keys('batch-').length, 0);
  assert.equal((await loadCounts(kv)).length, 0);
});

test('a single delete call can remove ids spanning multiple keys', async () => {
  const kv = makeFakeKv();
  const [a] = await appendCounts(kv, [record({ itemCode: 'A' })]);
  const [b] = await appendCounts(kv, [record({ itemCode: 'B' })]);
  const [c] = await appendCounts(kv, [record({ itemCode: 'C' })]);

  const deleted = await deleteCounts(kv, [a.id, c.id]);
  assert.equal(deleted, 2);

  const remainingIds = await idsOf(kv);
  assert.deepEqual(remainingIds, [b.id]);
});

test('deleting ids that do not exist anywhere is a safe no-op', async () => {
  const kv = makeFakeKv();
  await appendCounts(kv, [record({ itemCode: 'A' })]);

  const deleted = await deleteCounts(kv, ['nonexistent-id-1', 'nonexistent-id-2']);
  assert.equal(deleted, 0);
  assert.equal((await loadCounts(kv)).length, 1);
});

test('a mix of existing and non-existing ids only removes the ones that exist', async () => {
  const kv = makeFakeKv();
  const [a] = await appendCounts(kv, [record({ itemCode: 'A' })]);

  const deleted = await deleteCounts(kv, [a.id, 'nonexistent-id']);
  assert.equal(deleted, 1);
  assert.equal((await loadCounts(kv)).length, 0);
});

test('deletion also works correctly against already-consolidated archive- keys', async () => {
  const kv = makeFakeKv();
  const added = await appendCounts(kv, [record({ itemCode: 'A' }), record({ itemCode: 'B' })]);
  await consolidateBatches(kv); // both records now live in one archive- key
  assert.equal(kv._keys('batch-').length, 0);
  assert.equal(kv._keys('archive-').length, 1);

  const deleted = await deleteCounts(kv, [added[0].id]);
  assert.equal(deleted, 1);
  const remainingIds = await idsOf(kv);
  assert.deepEqual(remainingIds, [added[1].id]);
  // Archive key still exists (only partially emptied), not deleted outright.
  assert.equal(kv._keys('archive-').length, 1);
});

test('calling deleteCounts with an empty ids list deletes nothing', async () => {
  const kv = makeFakeKv();
  await appendCounts(kv, [record({ itemCode: 'A' })]);
  const deleted = await deleteCounts(kv, []);
  assert.equal(deleted, 0);
  assert.equal((await loadCounts(kv)).length, 1);
});
