const { isValidLocation } = require('./locations');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validates and normalizes a raw POST /api/counts request body into the
// record shape ready for db.appendCounts. Shared between the Express
// (src/app.js) and Cloudflare Workers (src/workerApp.js) routes so the two
// can't drift out of sync with each other.
//
// Returns either { records } on success, or { error, status } on failure.
function validateCountsSubmission(body) {
  const { person, location, items, date } = body || {};
  const personName = String(person || '').trim();
  const locationName = String(location || '').trim();
  if (!personName) return { error: 'Person name is required', status: 400 };
  if (!locationName) return { error: 'Location is required', status: 400 };
  if (!isValidLocation(locationName)) return { error: 'Invalid location', status: 400 };
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'No items submitted', status: 400 };
  }

  // Prefer the submitting phone's own local calendar date over the server's
  // (Cloudflare Workers run in UTC, so deriving "today" from its
  // clock shows the wrong date for anyone counting late at night in a
  // timezone ahead of UTC). Falls back to the server date if a client ever
  // omits it.
  const rawDate = String(date || '').trim();
  const countDate = ISO_DATE_RE.test(rawDate) && !Number.isNaN(Date.parse(rawDate))
    ? rawDate
    : new Date().toISOString().slice(0, 10);

  const records = [];
  for (const it of items) {
    const itemCode = String(it.itemCode || '').trim();
    const quantity = Number(it.quantity);
    if (!itemCode) return { error: 'Every row needs an item code', status: 400 };
    if (!Number.isFinite(quantity) || quantity < 0) {
      return { error: `Invalid quantity for item ${itemCode}`, status: 400 };
    }
    let expiryDate = '';
    const rawExpiry = String(it.expiryDate || '').trim();
    if (rawExpiry !== '') {
      if (!ISO_DATE_RE.test(rawExpiry) || Number.isNaN(Date.parse(rawExpiry))) {
        return { error: `Invalid expiry date for item ${itemCode}`, status: 400 };
      }
      expiryDate = rawExpiry;
    }
    // Defaults to 0 rather than rejecting the submission — this value is
    // reference data from the item master, not something the person counting
    // ever enters, so a submission should never fail because of it (e.g. an
    // item uploaded before this field existed, or with no Inventory value).
    const theoreticalInventoryRaw = Number(it.theoreticalInventory);
    const theoreticalInventory = Number.isFinite(theoreticalInventoryRaw) ? theoreticalInventoryRaw : 0;
    records.push({
      date: countDate,
      person: personName,
      location: locationName,
      itemCode,
      description: String(it.description || ''),
      uom: String(it.uom || ''),
      quantity,
      expiryDate,
      theoreticalInventory,
      difference: quantity - theoreticalInventory,
    });
  }

  return { records };
}

module.exports = { validateCountsSubmission };
