const path = require('path');
const fs = require('fs');
const { parseItemsFromBuffer } = require('../itemsParser');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ITEMS_JSON = path.join(DATA_DIR, 'items.json');
const ITEMS_META_JSON = path.join(DATA_DIR, 'items-meta.json');
const COUNTS_JSON = path.join(DATA_DIR, 'counts.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(COUNTS_JSON)) fs.writeFileSync(COUNTS_JSON, '[]');
if (!fs.existsSync(ITEMS_JSON)) fs.writeFileSync(ITEMS_JSON, '[]');

let itemsCache = null;
let itemsByCode = null;
let itemsByBarcode = null;

function loadItemsSync() {
  if (itemsCache) return itemsCache;
  itemsCache = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8'));
  itemsByCode = new Map();
  itemsByBarcode = new Map();
  for (const item of itemsCache) {
    itemsByCode.set(item.code.toUpperCase(), item);
    if (item.barcode) itemsByBarcode.set(item.barcode.toUpperCase(), item);
  }
  return itemsCache;
}

async function findItemByCode(rawCode) {
  loadItemsSync();
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  return itemsByCode.get(code) || itemsByBarcode.get(code) || null;
}

async function replaceItems(buffer) {
  const items = parseItemsFromBuffer(buffer);
  fs.writeFileSync(ITEMS_JSON, JSON.stringify(items, null, 2));
  fs.writeFileSync(ITEMS_META_JSON, JSON.stringify({ uploadedAt: new Date().toISOString(), count: items.length }));
  itemsCache = null;
  return items.length;
}

async function getItemsMeta() {
  const items = loadItemsSync();
  if (fs.existsSync(ITEMS_META_JSON)) {
    return JSON.parse(fs.readFileSync(ITEMS_META_JSON, 'utf8'));
  }
  // No upload recorded via the admin page (e.g. imported via the CLI script instead) —
  // fall back to the item file's own modified time.
  return { uploadedAt: fs.statSync(ITEMS_JSON).mtime.toISOString(), count: items.length };
}

// Wipes the item master entirely so no one can look up or scan items until
// the next upload — distinct from resetCounts, which only clears submitted counts.
async function clearItems() {
  fs.writeFileSync(ITEMS_JSON, '[]');
  fs.writeFileSync(ITEMS_META_JSON, JSON.stringify({ uploadedAt: null, count: 0, clearedAt: new Date().toISOString() }));
  itemsCache = null;
}

// Simple write queue to serialize writes to counts.json across concurrent requests
// within this one Node process (safe for the local/single-instance deployment target).
let writeQueue = Promise.resolve();
function queueWrite(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

async function loadCounts() {
  const counts = JSON.parse(fs.readFileSync(COUNTS_JSON, 'utf8'));
  // Matches the explicit sort in db/cloudflare.js — relying
  // on append-only insertion order happening to equal timestamp order is
  // fragile (e.g. if the file is ever manually edited), and groupCounts.js
  // depends on rows arriving sorted ascending by timestamp.
  counts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return counts;
}

async function appendCounts(records) {
  return queueWrite(() => {
    const counts = JSON.parse(fs.readFileSync(COUNTS_JSON, 'utf8'));
    let nextId = counts.reduce((max, c) => Math.max(max, c.id), 0) + 1;
    const now = new Date().toISOString();
    const added = records.map((r) => ({
      id: nextId++,
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
    counts.push(...added);
    fs.writeFileSync(COUNTS_JSON, JSON.stringify(counts, null, 2));
    return added;
  });
}

async function resetCounts() {
  return queueWrite(() => {
    fs.writeFileSync(COUNTS_JSON, '[]');
  });
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
