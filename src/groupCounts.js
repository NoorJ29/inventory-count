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

// Merges rows that match on person/date/location/itemCode/description/uom,
// summing quantity and recalculating difference from that summed quantity —
// a display/export-time transformation only; storage stays raw and ungrouped.
function groupCounts(rows) {
  const groups = new Map();
  const order = [];

  for (const row of rows) {
    const key = groupKey(row);
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
    // theoreticalInventory is the freshest snapshot for this item — not
    // necessarily the first-seen one.
    let theoreticalInventory;
    for (const m of group.members) {
      if (typeof m.theoreticalInventory === 'number' && Number.isFinite(m.theoreticalInventory)) {
        theoreticalInventory = m.theoreticalInventory;
      }
    }
    const difference = typeof theoreticalInventory === 'number'
      ? group.quantity - theoreticalInventory
      : undefined;
    const expiryDates = group.members.map((m) => m.expiryDate).filter(Boolean).sort();
    return { ...group, theoreticalInventory, difference, expiryDate: expiryDates[0] || '' };
  });
}

module.exports = { groupCounts };
