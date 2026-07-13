const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Date', key: 'date' },
  { header: 'Name', key: 'name' },
  { header: 'Location', key: 'location' },
  { header: 'Item Code', key: 'itemCode' },
  { header: 'Description', key: 'description' },
  { header: 'UOM', key: 'uom' },
  { header: 'Expiry Date', key: 'expiryDate' },
  { header: 'Quantity', key: 'quantity' },
  { header: 'System Inventory', key: 'theoreticalInventory' },
  { header: 'Difference', key: 'difference' },
];

function computeWidth(header, rows, key) {
  let max = String(header).length;
  for (const row of rows) {
    const val = row[key];
    const len = val === null || val === undefined ? 0 : String(val).length;
    if (len > max) max = len;
  }
  return Math.min(Math.max(max + 2, 8), 40);
}

// Builds the admin counts export as an xlsx buffer, with auto-fit column
// widths (based on the longest value in each column, header included) and
// a bold header row. Uses exceljs rather than the xlsx (SheetJS) package
// used elsewhere in this project — SheetJS's free/community build silently
// drops cell style info on write (confirmed directly: setting `.s` on a
// cell and passing `cellStyles: true` produced no `<b/>` in the output
// styles.xml), whereas exceljs writes both bold and column widths
// correctly and was confirmed to work under the Cloudflare Workers runtime
// too. This only affects the export/write path — reading the uploaded
// item-master file still uses `xlsx`, which is what actually parses that
// file's non-standard structure correctly (exceljs fails on that read).
async function buildExportWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory Count');
  sheet.columns = COLUMNS.map((col) => ({ ...col, width: computeWidth(col.header, rows, col.key) }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildExportWorkbook };
