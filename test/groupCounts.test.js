const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCounts, groupCountsForExport } = require('../src/groupCounts');

function row(overrides) {
  return {
    person: 'Romain',
    date: '2026-07-10',
    location: 'Chiller 1',
    itemCode: 'ADIGIND009',
    description: 'UTD 43 GIN 750ML',
    uom: 'UNIT',
    quantity: 10,
    expiryDate: '',
    theoreticalInventory: 10,
    unitCost: 5,
    ...overrides,
  };
}

test('rows matching on all six key fields are merged with summed quantity', () => {
  const [result] = groupCounts([row({ quantity: 10 }), row({ quantity: 5 })]);
  assert.equal(result.quantity, 15);
  assert.equal(result.members.length, 2);
});

test('rows differing in any key field are kept separate', () => {
  const result = groupCounts([row({ itemCode: 'A' }), row({ itemCode: 'B' })]);
  assert.equal(result.length, 2);
});

test('person name matching is case-insensitive and trimmed', () => {
  const [result] = groupCounts([row({ person: 'ROMAIN' }), row({ person: '  romain  ' })]);
  assert.equal(result.members.length, 2);
});

test('difference is recalculated from the summed quantity, not per-row', () => {
  const [result] = groupCounts([
    row({ quantity: 100, theoreticalInventory: 150 }),
    row({ quantity: 50, theoreticalInventory: 150 }),
  ]);
  assert.equal(result.quantity, 150);
  assert.equal(result.difference, 0);
});

test('theoreticalInventory uses the last member with a defined numeric value', () => {
  const [result] = groupCounts([
    row({ quantity: 1, theoreticalInventory: 999 }),
    row({ quantity: 1, theoreticalInventory: undefined }),
    row({ quantity: 1, theoreticalInventory: 42 }),
  ]);
  assert.equal(result.theoreticalInventory, 42);
  assert.equal(result.difference, 3 - 42);
});

test('difference is undefined (not NaN) when no member has a numeric theoreticalInventory', () => {
  const [result] = groupCounts([
    row({ quantity: 1, theoreticalInventory: undefined }),
    row({ quantity: 1, theoreticalInventory: undefined }),
  ]);
  assert.equal(result.theoreticalInventory, undefined);
  assert.equal(result.difference, undefined);
});

test('expiryDate picks the earliest non-blank date among members', () => {
  const [result] = groupCounts([
    row({ expiryDate: '' }),
    row({ expiryDate: '2027-05-01' }),
    row({ expiryDate: '2026-12-01' }),
  ]);
  assert.equal(result.expiryDate, '2026-12-01');
});

test('expiryDate is blank when no member has one', () => {
  const [result] = groupCounts([row({ expiryDate: '' }), row({ expiryDate: '' })]);
  assert.equal(result.expiryDate, '');
});

test('a single ungrouped row passes through unchanged aside from added fields', () => {
  const [result] = groupCounts([row({ quantity: 7 })]);
  assert.equal(result.quantity, 7);
  assert.equal(result.members.length, 1);
});

test('groupCounts preserves first-seen order of distinct groups', () => {
  const result = groupCounts([row({ itemCode: 'B' }), row({ itemCode: 'A' }), row({ itemCode: 'B' })]);
  assert.deepEqual(result.map((r) => r.itemCode), ['B', 'A']);
});

test('unitCost uses the last member with a defined numeric value', () => {
  const [result] = groupCounts([
    row({ unitCost: 10 }),
    row({ unitCost: undefined }),
    row({ unitCost: 25 }),
  ]);
  assert.equal(result.unitCost, 25);
});

test('differenceCost is difference times the resolved unitCost', () => {
  const [result] = groupCounts([
    row({ quantity: 100, theoreticalInventory: 150, unitCost: 4 }),
    row({ quantity: 50, theoreticalInventory: 150, unitCost: 4 }),
  ]);
  assert.equal(result.quantity, 150);
  assert.equal(result.difference, 0);
  assert.equal(result.differenceCost, 0);
});

test('differenceCost reflects a non-zero difference correctly', () => {
  const [result] = groupCounts([row({ quantity: 12, theoreticalInventory: 20, unitCost: 3 })]);
  assert.equal(result.difference, -8);
  assert.equal(result.differenceCost, -24);
});

test('differenceCost is undefined when unitCost is never defined, even with a valid difference', () => {
  const [result] = groupCounts([row({ quantity: 5, theoreticalInventory: 5, unitCost: undefined })]);
  assert.equal(result.difference, 0);
  assert.equal(result.differenceCost, undefined);
});

test('differenceCost is undefined when theoreticalInventory is never defined, even with a valid unitCost', () => {
  const [result] = groupCounts([row({ quantity: 5, theoreticalInventory: undefined, unitCost: 10 })]);
  assert.equal(result.difference, undefined);
  assert.equal(result.differenceCost, undefined);
});

test('differenceCost is a true 0, not -0, when unitCost is 0 and the difference is negative', () => {
  const [result] = groupCounts([row({ quantity: 5, theoreticalInventory: 20, unitCost: 0 })]);
  assert.equal(result.difference, -15);
  assert.equal(result.differenceCost, 0);
  assert.equal(Object.is(result.differenceCost, -0), false);
});

// ---- groupCountsForExport: the export's broader, person-agnostic grouping ----

test('groupCountsForExport merges rows from different people at the same product/date/location', () => {
  const [result] = groupCountsForExport([
    row({ person: 'Romain', quantity: 10 }),
    row({ person: 'Marie', quantity: 5 }),
  ]);
  assert.equal(result.quantity, 15);
  assert.equal(result.members.length, 2);
  assert.deepEqual(result.members.map((m) => m.person), ['Romain', 'Marie']);
});

test('groupCountsForExport still separates rows differing in product/date/location', () => {
  const result = groupCountsForExport([row({ itemCode: 'A' }), row({ itemCode: 'B' })]);
  assert.equal(result.length, 2);
});

test('groupCountsForExport ignores person entirely — even identical person values from a different key field split the group', () => {
  const result = groupCountsForExport([row({ location: 'Chiller 1' }), row({ location: 'Chiller 2' })]);
  assert.equal(result.length, 2);
});

test('groupCountsForExport resolves theoreticalInventory/unitCost/difference/differenceCost the same way as groupCounts', () => {
  const [result] = groupCountsForExport([
    row({ person: 'Romain', quantity: 100, theoreticalInventory: 150, unitCost: 4 }),
    row({ person: 'Marie', quantity: 50, theoreticalInventory: 150, unitCost: 4 }),
  ]);
  assert.equal(result.quantity, 150);
  assert.equal(result.difference, 0);
  assert.equal(result.differenceCost, 0);
});

test('groupCountsForExport preserves members in chronological (submission) order for numbering', () => {
  const [result] = groupCountsForExport([
    row({ person: 'First', quantity: 1 }),
    row({ person: 'Second', quantity: 2 }),
    row({ person: 'Third', quantity: 3 }),
  ]);
  assert.deepEqual(result.members.map((m) => m.person), ['First', 'Second', 'Third']);
});
