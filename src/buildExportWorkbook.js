const ExcelJS = require('exceljs');
const { formatPersonName } = require('./formatPersonName');

// Converts a stored ISO date (YYYY-MM-DD) to DD/MM/YYYY for display in the
// export — kept as a plain string rather than a native Excel date cell so it
// doesn't get reformatted based on the opening machine's locale.
function isoToDisplayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

// Builds the dynamic column list and row data for the export. Pure/testable
// on its own — takes the output of groupCountsForExport (each group's raw
// `members` are the individual recounts merged into it, in chronological
// order) and flattens each one into its own Name/Quantity/Expiry Date block,
// since a group can now combine different people's counts of the same
// product/date/location. The number of blocks is driven by whichever group
// has the most recounts; shorter groups just get blank cells for the rest.
function buildExportColumnsAndRows(groupedRows) {
  const maxMembers = Math.max(1, ...groupedRows.map((g) => g.members.length));

  const columns = [
    { header: 'Date', key: 'date' },
    { header: 'Location', key: 'location' },
    { header: 'Item Code', key: 'itemCode' },
    { header: 'Description', key: 'description' },
    { header: 'UOM', key: 'uom' },
    { header: 'Unit Cost', key: 'unitCost' },
  ];
  for (let i = 1; i <= maxMembers; i++) {
    columns.push({ header: `Name ${i}`, key: `name${i}` });
    columns.push({ header: `Quantity ${i}`, key: `quantity${i}` });
    columns.push({ header: `Expiry Date ${i}`, key: `expiryDate${i}` });
  }
  columns.push(
    { header: 'Total', key: 'total' },
    { header: 'System Inventory', key: 'theoreticalInventory' },
    { header: 'Difference', key: 'difference' },
    { header: 'Difference Cost', key: 'differenceCost' },
  );

  const rows = groupedRows.map((g) => {
    const row = {
      date: isoToDisplayDate(g.date),
      location: g.location || '',
      itemCode: g.itemCode,
      description: g.description,
      uom: g.uom,
      unitCost: g.unitCost ?? '',
      total: g.quantity,
      theoreticalInventory: g.theoreticalInventory ?? '',
      difference: g.difference ?? '',
      differenceCost: g.differenceCost ?? '',
    };
    g.members.forEach((m, idx) => {
      row[`name${idx + 1}`] = formatPersonName(m.person);
      row[`quantity${idx + 1}`] = m.quantity;
      row[`expiryDate${idx + 1}`] = isoToDisplayDate(m.expiryDate);
    });
    return row;
  });

  return { columns, rows };
}

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
async function buildExportWorkbook(groupedRows) {
  const { columns, rows } = buildExportColumnsAndRows(groupedRows);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Inventory Count');
  sheet.columns = columns.map((col) => ({ ...col, width: computeWidth(col.header, rows, col.key) }));
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildExportWorkbook, buildExportColumnsAndRows };
