const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPersonName } = require('../src/formatPersonName');

test('all-caps name becomes title case', () => {
  assert.equal(formatPersonName('ROMAIN'), 'Romain');
});

test('all-lowercase name becomes title case', () => {
  assert.equal(formatPersonName('romain'), 'Romain');
});

test('mixed-case name becomes title case', () => {
  assert.equal(formatPersonName('rOmAiN'), 'Romain');
});

test('leading/trailing whitespace is trimmed', () => {
  assert.equal(formatPersonName('  marie  '), 'Marie');
});

test('multi-word names are title-cased word by word', () => {
  assert.equal(formatPersonName('anne marie dupont'), 'Anne Marie Dupont');
});

test('hyphenated names capitalize after the hyphen too', () => {
  assert.equal(formatPersonName('jean-pierre'), 'Jean-Pierre');
});

test('empty or missing input returns an empty string', () => {
  assert.equal(formatPersonName(''), '');
  assert.equal(formatPersonName(undefined), '');
  assert.equal(formatPersonName(null), '');
});
