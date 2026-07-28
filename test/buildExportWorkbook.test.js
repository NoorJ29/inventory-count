const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExportColumnsAndRows } = require('../src/buildExportWorkbook');

// buildExportColumnsAndRows takes the output shape of groupCountsForExport —
// a grouped row plus its raw `members` (the individual recounts merged into
// it, in chronological order). These fixtures build that shape directly
// rather than going through groupCountsForExport, so this test focuses only
// on the column/row-flattening logic itself.
function group(overrides) {
  return {
    date: '2026-07-10',
    location: 'Chiller 1',
    itemCode: 'ADIGIND009',
    description: 'UTD 43 GIN 750ML',
    uom: 'UNIT',
    unitCost: 5,
    quantity: 10,
    theoreticalInventory: 8,
    difference: 2,
    differenceCost: 10,
    members: [{ person: 'romain', quantity: 10, expiryDate: '2026-12-25' }],
    ...overrides,
  };
}

test('a single-member group produces Name 1/Quantity 1/Expiry Date 1 matching that member, Total equal to it', () => {
  const { columns, rows } = buildExportColumnsAndRows([group()]);
  const headers = columns.map((c) => c.header);
  assert.deepEqual(headers.slice(0, 6), ['Date', 'Location', 'Item Code', 'Description', 'UOM', 'Unit Cost']);
  assert.ok(headers.includes('Name 1'));
  assert.ok(headers.includes('Quantity 1'));
  assert.ok(headers.includes('Expiry Date 1'));
  assert.ok(!headers.includes('Name 2'));

  const [row] = rows;
  assert.equal(row.name1, 'Romain');
  assert.equal(row.quantity1, 10);
  assert.equal(row.expiryDate1, '25/12/26');
  assert.equal(row.total, 10);
});

test('a 3-member group from 3 different people produces Name/Quantity/Expiry Date 1-3 in order, correct Total', () => {
  const g = group({
    quantity: 18,
    members: [
      { person: 'romain', quantity: 10, expiryDate: '2026-12-25' },
      { person: 'MARIE', quantity: 5, expiryDate: '' },
      { person: 'jean-pierre', quantity: 3, expiryDate: '2027-01-01' },
    ],
  });
  const { columns, rows } = buildExportColumnsAndRows([g]);
  const headers = columns.map((c) => c.header);
  assert.ok(headers.includes('Name 3'));
  assert.ok(headers.includes('Quantity 3'));
  assert.ok(headers.includes('Expiry Date 3'));

  const [row] = rows;
  assert.equal(row.name1, 'Romain');
  assert.equal(row.quantity1, 10);
  assert.equal(row.expiryDate1, '25/12/26');
  assert.equal(row.name2, 'Marie');
  assert.equal(row.quantity2, 5);
  assert.equal(row.expiryDate2, '');
  assert.equal(row.name3, 'Jean-Pierre');
  assert.equal(row.quantity3, 3);
  assert.equal(row.expiryDate3, '01/01/27');
  assert.equal(row.total, 18);
});

test('mixed dataset: column set reflects the max member count, shorter groups get undefined (blank) extra cells', () => {
  const threeMember = group({
    itemCode: 'A',
    members: [
      { person: 'romain', quantity: 10, expiryDate: '' },
      { person: 'marie', quantity: 5, expiryDate: '' },
      { person: 'jean', quantity: 3, expiryDate: '' },
    ],
  });
  const oneMember = group({ itemCode: 'B', members: [{ person: 'romain', quantity: 7, expiryDate: '' }] });

  const { columns, rows } = buildExportColumnsAndRows([threeMember, oneMember]);
  const headers = columns.map((c) => c.header);
  assert.ok(headers.includes('Name 3'));

  const shortRow = rows.find((r) => r.itemCode === 'B');
  assert.equal(shortRow.name1, 'Romain');
  assert.equal(shortRow.quantity1, 7);
  assert.equal(shortRow.name2, undefined);
  assert.equal(shortRow.quantity2, undefined);
  assert.equal(shortRow.expiryDate2, undefined);
  assert.equal(shortRow.name3, undefined);
});

test('the submission Date column uses a 4-digit year (DD/MM/YYYY), unchanged', () => {
  const g = group({ date: '2026-01-05', members: [{ person: 'romain', quantity: 1, expiryDate: '' }] });
  const { rows } = buildExportColumnsAndRows([g]);
  assert.equal(rows[0].date, '05/01/2026');
});

test('Expiry Date columns use a 2-digit year (DD/MM/YY)', () => {
  const g = group({ date: '2026-01-05', members: [{ person: 'romain', quantity: 1, expiryDate: '2026-02-14' }] });
  const { rows } = buildExportColumnsAndRows([g]);
  assert.equal(rows[0].expiryDate1, '14/02/26');
});

test('a blank expiry date renders as an empty string, not "NaN/NaN/NaN" or similar', () => {
  const g = group({ members: [{ person: 'romain', quantity: 1, expiryDate: '' }] });
  const { rows } = buildExportColumnsAndRows([g]);
  assert.equal(rows[0].expiryDate1, '');
});

test('unitCost/theoreticalInventory/difference/differenceCost pass through unchanged from the grouped input', () => {
  const g = group({ unitCost: 12.5, theoreticalInventory: 40, difference: -5, differenceCost: -62.5 });
  const { rows } = buildExportColumnsAndRows([g]);
  assert.equal(rows[0].unitCost, 12.5);
  assert.equal(rows[0].theoreticalInventory, 40);
  assert.equal(rows[0].difference, -5);
  assert.equal(rows[0].differenceCost, -62.5);
});

test('undefined theoreticalInventory/difference/differenceCost/unitCost render as empty strings, not "undefined"', () => {
  const g = group({ unitCost: undefined, theoreticalInventory: undefined, difference: undefined, differenceCost: undefined });
  const { rows } = buildExportColumnsAndRows([g]);
  assert.equal(rows[0].unitCost, '');
  assert.equal(rows[0].theoreticalInventory, '');
  assert.equal(rows[0].difference, '');
  assert.equal(rows[0].differenceCost, '');
});

test('base columns no longer include a single unnumbered Name column', () => {
  const { columns } = buildExportColumnsAndRows([group()]);
  assert.ok(!columns.some((c) => c.header === 'Name'));
  assert.ok(!columns.some((c) => c.key === 'name'));
});

test('Unit Cost and Difference Cost columns carry a #,##0 Excel number format, other columns do not', () => {
  const { columns } = buildExportColumnsAndRows([group()]);
  const byHeader = Object.fromEntries(columns.map((c) => [c.header, c]));
  assert.equal(byHeader['Unit Cost'].numFmt, '#,##0');
  assert.equal(byHeader['Difference Cost'].numFmt, '#,##0');
  assert.equal(byHeader['System Inventory'].numFmt, undefined);
  assert.equal(byHeader['Difference'].numFmt, undefined);
});

test('Total, System Inventory, Difference, and Difference Cost columns appear once, at the end', () => {
  const g = group({
    members: [
      { person: 'romain', quantity: 10, expiryDate: '' },
      { person: 'marie', quantity: 5, expiryDate: '' },
    ],
  });
  const { columns } = buildExportColumnsAndRows([g]);
  const headers = columns.map((c) => c.header);
  const tailStart = headers.length - 4;
  assert.deepEqual(headers.slice(tailStart), ['Total', 'System Inventory', 'Difference', 'Difference Cost']);
});
