// Shared accumulation/resolution logic behind both grouping variants below —
// the only thing that differs between them is which fields the key is built
// from; the summing/last-value-wins/difference math is identical either way.
function groupRows(rows, keyFn) {
  const groups = new Map();
  const order = [];

  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) {
      groups.set(key, { ...row, quantity: 0, members: [] });
      order.push(key);
    }
    const group = groups.get(key);
    group.quantity += Number(row.quantity) || 0;
    group.members.push(row);
  }

  return order.map((key) => {
    const group = groups.get(key);
    // members arrive sorted ascending by timestamp (guaranteed by loadCounts
    // in all storage backends), so the LAST member with a defined numeric
    // theoreticalInventory/unitCost is the freshest snapshot for this item —
    // not necessarily the first-seen one.
    let theoreticalInventory;
    let unitCost;
    for (const m of group.members) {
      if (typeof m.theoreticalInventory === 'number' && Number.isFinite(m.theoreticalInventory)) {
        theoreticalInventory = m.theoreticalInventory;
      }
      if (typeof m.unitCost === 'number' && Number.isFinite(m.unitCost)) {
        unitCost = m.unitCost;
      }
    }
    const difference = typeof theoreticalInventory === 'number'
      ? group.quantity - theoreticalInventory
      : undefined;
    const differenceCost = typeof difference === 'number' && typeof unitCost === 'number'
      ? difference * unitCost
      : undefined;
    const expiryDates = group.members.map((m) => m.expiryDate).filter(Boolean).sort();
    return { ...group, theoreticalInventory, difference, unitCost, differenceCost, expiryDate: expiryDates[0] || '' };
  });
}

// Admin page's grouping — merges rows that match on person/date/location/
// itemCode/description/uom, summing quantity and recalculating difference
// from that summed quantity. A display/export-time transformation only;
// storage stays raw and ungrouped.
function groupKey(row) {
  return JSON.stringify([
    (row.person || '').trim().toLowerCase(),
    row.date || '',
    row.location || '',
    row.itemCode || '',
    row.description || '',
    row.uom || '',
  ]);
}
function groupCounts(rows) {
  return groupRows(rows, groupKey);
}

// Excel export's own, broader grouping — merges on date/location/itemCode/
// description/uom only, regardless of who did the counting. For a given
// product at a given location on a given date there's only one System
// Inventory value to compare against, so the export combines every
// recount of it into one row (with each contributor broken out via
// buildExportWorkbook's per-recount Name/Quantity/Expiry Date columns)
// even when different people did the counting — unlike the admin page's
// groupCounts above, which only merges same-person recounts.
function groupKeyForExport(row) {
  return JSON.stringify([
    row.date || '',
    row.location || '',
    row.itemCode || '',
    row.description || '',
    row.uom || '',
  ]);
}
function groupCountsForExport(rows) {
  return groupRows(rows, groupKeyForExport);
}

module.exports = { groupCounts, groupCountsForExport };
