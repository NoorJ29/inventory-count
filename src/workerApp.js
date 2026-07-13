import { Hono } from 'hono';
import adminHtml from '../views/admin.html';
import { LOCATIONS } from './locations.js';
import { groupCounts } from './groupCounts.js';
import { buildExportWorkbook } from './buildExportWorkbook.js';
import { formatPersonName } from './formatPersonName.js';
import { validateCountsSubmission } from './validateCountsSubmission.js';
import * as db from './db/cloudflare.js';

// Converts a stored ISO date (YYYY-MM-DD) to DD/MM/YYYY for display in the
// export — kept as a plain string rather than a native Excel date cell so it
// doesn't get reformatted based on the opening machine's locale.
function isoToDisplayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

// Hono's built-in basicAuth middleware expects static credentials at setup
// time, but ours only exist per-request via c.env (Workers bindings/secrets
// aren't available at module-load time) — so this is a small hand-rolled
// equivalent instead.
async function requireAdminAuth(c, next) {
  const expectedUser = c.env.ADMIN_USER || 'admin';
  const expectedPassword = c.env.ADMIN_PASSWORD || 'changeme';
  const expected = 'Basic ' + btoa(`${expectedUser}:${expectedPassword}`);
  const actual = c.req.header('Authorization') || '';
  if (actual !== expected) {
    return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="Inventory Admin"' });
  }
  await next();
}

const app = new Hono();

// ---- Public counting API ----

app.get('/api/locations', (c) => c.json(LOCATIONS));

app.get('/api/items/status', async (c) => {
  try {
    const meta = await db.getItemsMeta(c.env.INVENTORY_KV);
    return c.json({ available: meta.count > 0, count: meta.count });
  } catch (err) {
    return c.json({ error: 'Failed to load item list status' }, 500);
  }
});

app.get('/api/items/:code', async (c) => {
  try {
    const item = await db.findItemByCode(c.env.INVENTORY_KV, c.req.param('code'));
    if (!item) return c.json({ error: 'Item not found' }, 404);
    return c.json(item);
  } catch (err) {
    return c.json({ error: 'Lookup failed' }, 500);
  }
});

app.post('/api/counts', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = validateCountsSubmission(body);
  if (result.error) return c.json({ error: result.error }, result.status);

  try {
    const added = await db.appendCounts(c.env.INVENTORY_KV, result.records);
    return c.json({ ok: true, added: added.length });
  } catch (err) {
    return c.json({ error: 'Failed to save counts' }, 500);
  }
});

// ---- Admin API (basic auth protected) ----

app.get('/api/admin/counts', requireAdminAuth, async (c) => {
  try {
    return c.json(await db.loadCounts(c.env.INVENTORY_KV));
  } catch (err) {
    return c.json({ error: 'Failed to load counts' }, 500);
  }
});

app.post('/api/admin/counts/reset', requireAdminAuth, async (c) => {
  try {
    await db.resetCounts(c.env.INVENTORY_KV);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to reset counts' }, 500);
  }
});

app.get('/api/admin/counts/export', requireAdminAuth, async (c) => {
  try {
    const counts = await db.loadCounts(c.env.INVENTORY_KV);
    const grouped = groupCounts(counts);
    const rows = grouped.map((cnt) => ({
      date: isoToDisplayDate(cnt.date),
      name: formatPersonName(cnt.person),
      location: cnt.location || '',
      itemCode: cnt.itemCode,
      description: cnt.description,
      uom: cnt.uom,
      expiryDate: isoToDisplayDate(cnt.expiryDate),
      quantity: cnt.quantity,
      theoreticalInventory: cnt.theoreticalInventory ?? '',
      difference: cnt.difference ?? '',
    }));
    const buffer = await buildExportWorkbook(rows);

    return c.body(buffer, 200, {
      'Content-Disposition': `attachment; filename="inventory-count-${Date.now()}.xlsx"`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } catch (err) {
    return c.json({ error: 'Failed to export counts' }, 500);
  }
});

app.get('/api/admin/items/meta', requireAdminAuth, async (c) => {
  try {
    return c.json(await db.getItemsMeta(c.env.INVENTORY_KV));
  } catch (err) {
    return c.json({ error: 'Failed to load item list status' }, 500);
  }
});

// Item list upload as base64 JSON (rather than multipart/disk) — matches the
// other deployment targets and needs no persistent filesystem.
app.post('/api/admin/items/upload', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { data } = body || {};
  if (!data) return c.json({ error: 'No file data received' }, 400);
  try {
    const buffer = Buffer.from(data, 'base64');
    const count = await db.replaceItems(c.env.INVENTORY_KV, buffer);
    return c.json({ ok: true, count });
  } catch (err) {
    return c.json({ error: err.message }, 400);
  }
});

app.post('/api/admin/items/clear', requireAdminAuth, async (c) => {
  try {
    await db.clearItems(c.env.INVENTORY_KV);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to clear item list' }, 500);
  }
});

// admin.html is bundled directly into the Worker as a text import (see the
// Text module rule in wrangler.toml) rather than living in the static assets
// directory — so it is only ever reachable through this authenticated route,
// never by guessing a static file URL.
app.get('/admin', requireAdminAuth, (c) => c.html(adminHtml));

export default {
  fetch: app.fetch,
};
