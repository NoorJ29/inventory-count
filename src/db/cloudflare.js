const { parseItemsFromBuffer } = require('../itemsParser');

const ITEMS_KEY = 'items';
const ITEMS_META_KEY = 'items-meta';
const BATCH_PREFIX = 'batch-';
// Consolidated keys produced by consolidateBatches() below — same shape as a
// batch- key (a JSON array of records), just merged from many small ones.
const ARCHIVE_PREFIX = 'archive-';
// Cloudflare's free plan caps a single request at 1,000 calls to its own
// services (KV included) — this is a hard total per request, not a
// concurrency limit. Capped well under that so a single consolidation run
// can never risk hitting it itself, even if it's badly overdue; any excess
// is simply left for the next scheduled run to pick up.
const CONSOLIDATE_CHUNK_SIZE = 500;

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
    unitCost: r.unitCost,
    differenceCost: r.differenceCost,
  }));

  const batchKey = `${BATCH_PREFIX}${Date.now()}-${crypto.randomUUID()}`;
  await kv.put(batchKey, JSON.stringify(added));
  return added;
}

async function listKeysWithPrefix(kv, prefix) {
  const keys = [];
  let cursor;
  for (;;) {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys.map((k) => k.name));
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return keys;
}

async function loadCounts(kv) {
  const keys = [
    ...(await listKeysWithPrefix(kv, BATCH_PREFIX)),
    ...(await listKeysWithPrefix(kv, ARCHIVE_PREFIX)),
  ];
  const batches = await Promise.all(keys.map((key) => kv.get(key, { type: 'json' })));
  const rows = batches.flat().filter(Boolean);
  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return rows;
}

async function resetCounts(kv) {
  const keys = [
    ...(await listKeysWithPrefix(kv, BATCH_PREFIX)),
    ...(await listKeysWithPrefix(kv, ARCHIVE_PREFIX)),
  ];
  await Promise.all(keys.map((key) => kv.delete(key)));
}

// Removes specific count records by id (used by the admin page's Edit Mode
// row-delete, as opposed to resetCounts which wipes everything). Since
// records live inside multi-record batch-/archive- keys rather than one key
// per record, this has to find whichever key(s) hold the targeted ids,
// rewrite each affected key with those records filtered out (or delete the
// key entirely if that empties it), and leave every other key untouched.
// Returns how many records were actually removed.
async function deleteCounts(kv, ids) {
  const idSet = new Set(ids);
  const keys = [
    ...(await listKeysWithPrefix(kv, BATCH_PREFIX)),
    ...(await listKeysWithPrefix(kv, ARCHIVE_PREFIX)),
  ];
  let deletedCount = 0;
  for (const key of keys) {
    const records = await kv.get(key, { type: 'json' });
    if (!records) continue;
    const remaining = records.filter((r) => !idSet.has(r.id));
    if (remaining.length === records.length) continue; // nothing in this key matched
    deletedCount += records.length - remaining.length;
    if (remaining.length === 0) await kv.delete(key);
    else await kv.put(key, JSON.stringify(remaining));
  }
  return deletedCount;
}

// Runs on a daily Cron Trigger (see wrangler.toml), completely outside any
// request a user waits on. Merges a batch of small batch- keys into one
// larger archive- key so loadCounts/resetCounts never have to read more
// keys in one request than Cloudflare's free-plan cap allows, no matter how
// long it's been since anyone last hit Export & Reset. The merged copy is
// written and confirmed *before* the originals are deleted, so a failure
// partway through can never lose data — at worst some keys are left
// unconsolidated for the next scheduled run to pick up.
async function consolidateBatches(kv) {
  const keys = (await listKeysWithPrefix(kv, BATCH_PREFIX)).slice(0, CONSOLIDATE_CHUNK_SIZE);
  if (keys.length === 0) return;
  const batches = await Promise.all(keys.map((key) => kv.get(key, { type: 'json' })));
  const rows = batches.flat().filter(Boolean);
  const archiveKey = `${ARCHIVE_PREFIX}${Date.now()}-${crypto.randomUUID()}`;
  await kv.put(archiveKey, JSON.stringify(rows));
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
  deleteCounts,
  consolidateBatches,
};
