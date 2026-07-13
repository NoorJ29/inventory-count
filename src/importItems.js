const path = require('path');
const fs = require('fs');
const { parseItemsFromFile } = require('./itemsParser');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ITEMS_JSON = path.join(DATA_DIR, 'items.json');

function importItemsFromFile(filePath) {
  const items = parseItemsFromFile(filePath);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ITEMS_JSON, JSON.stringify(items, null, 2));
  return items.length;
}

if (require.main === module) {
  const inputFile = process.argv[2] || path.join(__dirname, '..', 'Items (14).xlsx');
  try {
    const count = importItemsFromFile(inputFile);
    console.log(`Imported ${count} items into ${ITEMS_JSON}`);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  }
}

module.exports = { importItemsFromFile, ITEMS_JSON };
