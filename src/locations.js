const LOCATIONS = [
  'Chiller 1', 'Chiller 2',
  'Freezer 1', 'Freezer 2', 'Freezer 3', 'Freezer 4',
  'Container 1', 'Container 2', 'Container 3',
  'Cave', 'Dry Store', 'Monin', 'Logidis', 'MFD',
];

function isValidLocation(value) {
  return LOCATIONS.includes(value);
}

module.exports = { LOCATIONS, isValidLocation };
