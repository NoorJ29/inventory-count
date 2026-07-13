const XLSX = require('xlsx');

function truthy(val) {
  if (val === true) return true;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const v = val.trim().toUpperCase();
    return v === '=TRUE()' || v === 'TRUE' || v === '1';
  }
  return false;
}

function parseItemsWorkbook(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rows.length) throw new Error('Uploaded file has no rows');
  const header = rows[0].map((h) => String(h).trim());

  const idxCode = header.indexOf('No.');
  const idxDesc = header.indexOf('Description');
  const idxUom = header.indexOf('Base Unit of Measure');
  const idxBarcode = header.indexOf('Barcode');
  const idxBlocked = header.indexOf('Blocked');
  const idxArchive = header.indexOf('Archive');
  const idxInventory = header.indexOf('Inventory');

  if (idxCode === -1 || idxDesc === -1 || idxUom === -1) {
    throw new Error('Expected columns "No.", "Description", "Base Unit of Measure" not found in uploaded file');
  }

  const items = [];
  const seen = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const codeRaw = row[idxCode];
    if (codeRaw === undefined || codeRaw === null || codeRaw === '') continue;
    const codeStr = String(codeRaw).trim();
    if (!codeStr) continue;

    const blocked = idxBlocked !== -1 ? truthy(row[idxBlocked]) : false;
    const archived = idxArchive !== -1 ? truthy(row[idxArchive]) : false;
    if (blocked || archived) continue;

    if (seen.has(codeStr)) continue;
    seen.add(codeStr);

    const inventoryRaw = idxInventory !== -1 ? Number(row[idxInventory]) : 0;

    items.push({
      code: codeStr,
      description: String(row[idxDesc] || '').trim(),
      uom: String(row[idxUom] || '').trim(),
      barcode: idxBarcode !== -1 ? String(row[idxBarcode] || '').trim() : '',
      theoreticalInventory: Number.isFinite(inventoryRaw) ? inventoryRaw : 0,
    });
  }

  return items;
}

function parseItemsFromFile(filePath) {
  return parseItemsWorkbook(XLSX.readFile(filePath));
}

function parseItemsFromBuffer(buffer) {
  return parseItemsWorkbook(XLSX.read(buffer, { type: 'buffer' }));
}

module.exports = { parseItemsWorkbook, parseItemsFromFile, parseItemsFromBuffer };
