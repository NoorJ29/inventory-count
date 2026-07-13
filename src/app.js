const path = require('path');
const express = require('express');
const basicAuth = require('express-basic-auth');

const db = require('./db/local');
const { LOCATIONS } = require('./locations');
const { groupCounts } = require('./groupCounts');
const { buildExportWorkbook } = require('./buildExportWorkbook');
const { formatPersonName } = require('./formatPersonName');
const { validateCountsSubmission } = require('./validateCountsSubmission');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

const app = express();
app.use(express.json({ limit: '15mb' })); // headroom for base64-encoded item-list uploads

const adminAuth = basicAuth({
  users: { [ADMIN_USER]: ADMIN_PASSWORD },
  challenge: true,
  realm: 'Inventory Admin',
});

const apiRouter = express.Router();

// ---- Public counting API ----

// Registered before /items/:code so "status" is never mistaken for an item code.
apiRouter.get('/items/status', async (req, res) => {
  try {
    const meta = await db.getItemsMeta();
    res.json({ available: meta.count > 0, count: meta.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load item list status' });
  }
});

apiRouter.get('/locations', (req, res) => {
  res.json(LOCATIONS);
});

apiRouter.get('/items/:code', async (req, res) => {
  try {
    const item = await db.findItemByCode(req.params.code);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

apiRouter.post('/counts', async (req, res) => {
  const result = validateCountsSubmission(req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });

  try {
    const added = await db.appendCounts(result.records);
    res.json({ ok: true, added: added.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save counts' });
  }
});

// ---- Admin API (basic auth protected) ----

apiRouter.get('/admin/counts', adminAuth, async (req, res) => {
  try {
    res.json(await db.loadCounts());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load counts' });
  }
});

apiRouter.post('/admin/counts/reset', adminAuth, async (req, res) => {
  try {
    await db.resetCounts();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset counts' });
  }
});

// Converts a stored ISO date (YYYY-MM-DD) to DD/MM/YYYY for display in the
// export — kept as a plain string rather than a native Excel date cell so it
// doesn't get reformatted based on the opening machine's locale.
function isoToDisplayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

apiRouter.get('/admin/counts/export', adminAuth, async (req, res) => {
  try {
    const counts = await db.loadCounts();
    const grouped = groupCounts(counts);
    const rows = grouped.map((c) => ({
      date: isoToDisplayDate(c.date),
      name: formatPersonName(c.person),
      location: c.location || '',
      itemCode: c.itemCode,
      description: c.description,
      uom: c.uom,
      expiryDate: isoToDisplayDate(c.expiryDate),
      quantity: c.quantity,
      theoreticalInventory: c.theoreticalInventory ?? '',
      difference: c.difference ?? '',
    }));
    const buffer = await buildExportWorkbook(rows);

    res.setHeader('Content-Disposition', `attachment; filename="inventory-count-${Date.now()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export counts' });
  }
});

apiRouter.get('/admin/items/meta', adminAuth, async (req, res) => {
  try {
    res.json(await db.getItemsMeta());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load item list status' });
  }
});

// Item list upload as base64 JSON (rather than multipart/disk) so this works
// identically whether running on a local disk-backed server or a serverless
// function with no persistent filesystem.
apiRouter.post('/admin/items/upload', adminAuth, async (req, res) => {
  const { data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'No file data received' });
  try {
    const buffer = Buffer.from(data, 'base64');
    const count = await db.replaceItems(buffer);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Wipes the item master so scanning/lookup stops working for everyone until
// the next upload — for when a count session is over and the data shouldn't
// linger in the system.
apiRouter.post('/admin/items/clear', adminAuth, async (req, res) => {
  try {
    await db.clearItems();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear item list' });
  }
});

app.use('/api', apiRouter);

function serveAdminPage(req, res) {
  res.sendFile(path.join(__dirname, '..', 'views', 'admin.html'));
}
app.get('/admin', adminAuth, serveAdminPage);

app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = { app, ADMIN_PASSWORD };
