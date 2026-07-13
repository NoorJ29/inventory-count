const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCountsSubmission } = require('../src/validateCountsSubmission');

function validBody(overrides) {
  return {
    person: 'Romain',
    location: 'Chiller 1',
    items: [{ itemCode: 'ADIGIND009', quantity: 5 }],
    ...overrides,
  };
}

test('a well-formed submission succeeds and returns one record per item', () => {
  const result = validateCountsSubmission(validBody());
  assert.equal(result.error, undefined);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].person, 'Romain');
  assert.equal(result.records[0].itemCode, 'ADIGIND009');
});

test('missing person is rejected', () => {
  const result = validateCountsSubmission(validBody({ person: '' }));
  assert.equal(result.status, 400);
  assert.match(result.error, /person/i);
});

test('missing location is rejected', () => {
  const result = validateCountsSubmission(validBody({ location: '' }));
  assert.equal(result.status, 400);
  assert.match(result.error, /location/i);
});

test('a location not in the known list is rejected', () => {
  const result = validateCountsSubmission(validBody({ location: 'Not A Real Location' }));
  assert.equal(result.status, 400);
  assert.match(result.error, /invalid location/i);
});

test('an empty items array is rejected', () => {
  const result = validateCountsSubmission(validBody({ items: [] }));
  assert.equal(result.status, 400);
  assert.match(result.error, /no items/i);
});

test('a missing items array is rejected', () => {
  const result = validateCountsSubmission(validBody({ items: undefined }));
  assert.equal(result.status, 400);
});

test('a row with no item code is rejected', () => {
  const result = validateCountsSubmission(validBody({ items: [{ quantity: 1 }] }));
  assert.equal(result.status, 400);
  assert.match(result.error, /item code/i);
});

test('a negative quantity is rejected', () => {
  const result = validateCountsSubmission(validBody({ items: [{ itemCode: 'X', quantity: -1 }] }));
  assert.equal(result.status, 400);
  assert.match(result.error, /quantity/i);
});

test('a non-numeric quantity is rejected', () => {
  const result = validateCountsSubmission(validBody({ items: [{ itemCode: 'X', quantity: 'abc' }] }));
  assert.equal(result.status, 400);
});

test('a quantity of exactly zero is allowed', () => {
  const result = validateCountsSubmission(validBody({ items: [{ itemCode: 'X', quantity: 0 }] }));
  assert.equal(result.error, undefined);
  assert.equal(result.records[0].quantity, 0);
});

test('a malformed expiry date is rejected', () => {
  const result = validateCountsSubmission(validBody({
    items: [{ itemCode: 'X', quantity: 1, expiryDate: 'not-a-date' }],
  }));
  assert.equal(result.status, 400);
  assert.match(result.error, /expiry/i);
});

test('a blank expiry date is allowed and stored as empty string', () => {
  const result = validateCountsSubmission(validBody({
    items: [{ itemCode: 'X', quantity: 1, expiryDate: '' }],
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.records[0].expiryDate, '');
});

test('theoreticalInventory defaults to 0 when missing or non-numeric, rather than rejecting', () => {
  const result = validateCountsSubmission(validBody({
    items: [{ itemCode: 'X', quantity: 5, theoreticalInventory: undefined }],
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.records[0].theoreticalInventory, 0);
  assert.equal(result.records[0].difference, 5);
});

test('difference is quantity minus theoreticalInventory', () => {
  const result = validateCountsSubmission(validBody({
    items: [{ itemCode: 'X', quantity: 12, theoreticalInventory: 20 }],
  }));
  assert.equal(result.records[0].difference, -8);
});

// ---- date handling: the exact bug fixed earlier this session ----

test('an explicit valid client date is used as-is, not the server clock', () => {
  const result = validateCountsSubmission(validBody({ date: '2099-01-01' }));
  assert.equal(result.records[0].date, '2099-01-01');
});

test('a missing date falls back to the server\'s own current date', () => {
  const expectedFallback = new Date().toISOString().slice(0, 10);
  const result = validateCountsSubmission(validBody({ date: undefined }));
  assert.equal(result.records[0].date, expectedFallback);
});

test('a malformed date string falls back rather than being stored verbatim', () => {
  const expectedFallback = new Date().toISOString().slice(0, 10);
  const result = validateCountsSubmission(validBody({ date: 'not-a-date' }));
  assert.equal(result.records[0].date, expectedFallback);
});

test('every record in a multi-item submission gets the same date', () => {
  const result = validateCountsSubmission(validBody({
    date: '2026-07-13',
    items: [
      { itemCode: 'A', quantity: 1 },
      { itemCode: 'B', quantity: 2 },
    ],
  }));
  assert.equal(result.records[0].date, '2026-07-13');
  assert.equal(result.records[1].date, '2026-07-13');
});
