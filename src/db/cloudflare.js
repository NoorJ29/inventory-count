const { parseItemsFromBuffer } = require('../itemsParser');

const ITEMS_KEY = 'items';
const ITEMS_META_KEY = 'items-meta';
const BATCH_PREFIX = 'batch-';

// Workers KV bindings are delivered per-request via the Worker's `env`, not a
// global like process.env — every function here takes the KV namespace as an
// explicit first argument rather than assuming a module-level singleton.

async function findItemByCode(kv, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;

  const items = (await kv.get(ITEMS_KEY, { type: 'json' })) || [];
  for (const item of items) {
    if (item.code.toUpperCase() === code) return item;
  }
  for (const item of items) {
    if (item.barcode && item.barcode.toUpperCase() === code) return item;
  }
  return null;
}

async function replaceItems(kv, buffer) {
  const items = parseItemsFromBuffer(buffer);
  await kv.put(ITEMS_KEY, JSON.stringify(items));
  await kv.put(ITEMS_META_KEY, JSON.stringify({ uploadedAt: new Date().toISOString(), count: items.length }));
  return items.length;
}

async function getItemsMeta(kv) {
  const meta = await kv.get(ITEMS_META_KEY, { type: 'json' });
  if (meta) return meta;
  const items = (await kv.get(ITEMS_KEY, { type: 'json' })) || [];
  return { uploadedAt: null, count: items.length };
}

async function clearItems(kv) {
  await kv.put(ITEMS_KEY, JSON.stringify([]));
  await kv.put(ITEMS_META_KEY, JSON.stringify({ uploadedAt: null, count: 0, clearedAt: new Date().toISOString() }));
}

// Each submission is written as its own key under the batch- prefix, so
// concurrent submissions never need a read-modify-write on shared state.
async function appendCounts(kv, records) {
  const now = new Date().toISOString();
  const added = records.map((r) => ({
    id: crypto.randomUUID(),
    date: r.date,
    timestamp: now,
    person: r.person,
    location: r.location,
    itemCode: r.itemCode,
    description: r.description,
    uom: r.uom,
    quantity: r.quantity,
    expiryDate: r.expiryDate,
    theoreticalInventory: r.theoreticalInventory,
    difference: r.difference,
  }));

  const batchKey = `${BATCH_PREFIX}${Date.now()}-${crypto.randomUUID()}`;
  await kv.put(batchKey, JSON.stringify(added));
  return added;
}

async function listBatchKeys(kv) {
  const keys = [];
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix: BATCH_PREFIX, cursor });
    keys.push(...page.keys.map((k) => k.name));
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return keys;
}

async function loadCounts(kv) {
  const keys = await listBatchKeys(kv);
  const batches = await Promise.all(keys.map((key) => kv.get(key, { type: 'json' })));
  const rows = batches.flat().filter(Boolean);
  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return rows;
}

async function resetCounts(kv) {
  const keys = await listBatchKeys(kv);
  await Promise.all(keys.map((key) => kv.delete(key)));
}

module.exports = {
  findItemByCode,
  replaceItems,
  getItemsMeta,
  clearItems,
  loadCounts,
  appendCounts,
  resetCounts,
};
