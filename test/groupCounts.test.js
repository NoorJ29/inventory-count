const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCounts } = require('../src/groupCounts');

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
