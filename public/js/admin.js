(function () {
  const countsBody = document.getElementById('countsBody');
  const summaryBar = document.getElementById('summaryBar');
  const btnExport = document.getElementById('btnExport');
  const btnReset = document.getElementById('btnReset');
  const btnRefresh = document.getElementById('btnRefresh');
  const fileUpload = document.getElementById('fileUpload');
  const uploadStatus = document.getElementById('uploadStatus');
  const itemMetaNotice = document.getElementById('itemMetaNotice');
  const btnClearItems = document.getElementById('btnClearItems');
  const btnEditMode = document.getElementById('btnEditMode');
  const countsTable = document.querySelector('table.counts-table');

  // ---- Toolbar dropdowns (Export/Clear, Item List) ----
  // Generic toggle: each [data-dropdown-toggle] button opens the menu whose
  // id matches its attribute value. Clicking an item inside a menu closes it
  // (after the item's own click handler runs, e.g. triggering the file
  // picker or starting the export), same as clicking anywhere outside or
  // pressing Escape.
  document.querySelectorAll('[data-dropdown-toggle]').forEach((toggle) => {
    const menu = document.getElementById(toggle.dataset.dropdownToggle);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      document.querySelectorAll('.dropdown-menu.open').forEach((m) => m.classList.remove('open'));
      if (!isOpen) menu.classList.add('open');
    });
    menu.addEventListener('click', () => menu.classList.remove('open'));
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-menu.open').forEach((m) => m.classList.remove('open'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.dropdown-menu.open').forEach((m) => m.classList.remove('open'));
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Used for the submission Date column only — Expiry Date uses
  // formatExpiryDisplay below (2-digit year) instead.
  function formatDateDisplay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
  }

  // Same as formatDateDisplay but with a 2-digit year (DD/MM/YY) — used only
  // for Expiry Date, never the submission Date column.
  function formatExpiryDisplay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y.slice(-2)}`;
  }

  // Keep in sync with src/formatPersonName.js — standardizes a free-text
  // name for display (first letter of each word capitalized, rest
  // lowercase) regardless of how it was typed. Raw stored data is untouched.
  function formatPersonName(name) {
    return String(name || '').trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Rounds to a whole number and adds thousands separators — used for Unit
  // Cost/Difference Cost only. The underlying value stays full-precision;
  // this only affects what's rendered.
  function formatMoney(value) {
    if (value === undefined || value === null || value === '') return '';
    // `|| 0` guards against -0 (toLocaleString renders it as "-0" otherwise).
    const rounded = Math.round(value) || 0;
    return rounded.toLocaleString('en-US');
  }

  function formatDifference(diff) {
    if (diff === undefined || diff === null || diff === '') return '';
    if (diff > 0) return `<span class="diff-positive">+${diff}</span>`;
    if (diff < 0) return `<span class="diff-negative">${diff}</span>`;
    return `<span class="diff-zero">${diff}</span>`;
  }

  // Same +/color-coding shape as formatDifference, but the number text goes
  // through formatMoney (no decimals, comma-grouped) since this is currency.
  function formatDifferenceCost(value) {
    if (value === undefined || value === null || value === '') return '';
    const formatted = formatMoney(value);
    if (value > 0) return `<span class="diff-positive">+${formatted}</span>`;
    if (value < 0) return `<span class="diff-negative">${formatted}</span>`;
    return `<span class="diff-zero">${formatted}</span>`;
  }

  // Keep in sync with src/groupCounts.js — no bundler exists to share this
  // between the browser and the server, so both carry their own copy.
  function groupKey(row) {
    return JSON.stringify([
      (row.person || '').trim().toLowerCase(),
      row.date || '', row.location || '', row.itemCode || '',
      row.description || '', row.uom || '',
    ]);
  }

  function groupCounts(rows) {
    const groups = new Map();
    const order = [];
    for (const row of rows) {
      const key = groupKey(row);
      if (!groups.has(key)) {
        groups.set(key, { ...row, quantity: 0, members: [] });
        order.push(key);
      }
      const group = groups.get(key);
      group.quantity += Number(row.quantity) || 0;
      group.members.push(row);
    }
    return order.map((key) => {
      const group = groups.get(key);
      let theoreticalInventory;
      let unitCost;
      for (const m of group.members) {
        if (typeof m.theoreticalInventory === 'number' && Number.isFinite(m.theoreticalInventory)) {
          theoreticalInventory = m.theoreticalInventory;
        }
        if (typeof m.unitCost === 'number' && Number.isFinite(m.unitCost)) {
          unitCost = m.unitCost;
        }
      }
      const difference = typeof theoreticalInventory === 'number'
        ? group.quantity - theoreticalInventory
        : undefined;
      // The `|| 0` guards against -0 (e.g. a zero unitCost times a negative
      // difference produces -0 in JS) — mathematically equal to 0, but
      // toLocaleString (used by formatMoney) renders it as "-0" otherwise.
      const differenceCost = typeof difference === 'number' && typeof unitCost === 'number'
        ? (difference * unitCost) || 0
        : undefined;
      const expiryDates = group.members.map((m) => m.expiryDate).filter(Boolean).sort();
      return { ...group, theoreticalInventory, difference, unitCost, differenceCost, expiryDate: expiryDates[0] || '' };
    });
  }

  function renderInfoIcon(members, idx) {
    if (members.length <= 1) return '';
    return `
      <span class="info-icon" tabindex="0" data-idx="${idx}" aria-label="Show individual counts">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </span>
    `;
  }

  // ---- Column config driving both table rendering and the sort/filter
  // popup below. `getRaw` is used for sorting/checklist-ordering (real
  // numbers/ISO dates, not the formatted string); `getDisplay` is the
  // formatted string used both as the cell's default text and as the
  // filter checklist's label/value — keeping what's shown and what's
  // matched always in sync. Cells needing extra markup (the merge info
  // icon, the colored Difference/Difference Cost spans) are special-cased
  // in cellHtml() below rather than here.
  const COLUMNS = [
    { key: 'date', header: 'Date', type: 'date', getRaw: (g) => g.date || '', getDisplay: (g) => formatDateDisplay(g.date) },
    { key: 'person', header: 'Name', type: 'text', getRaw: (g) => formatPersonName(g.person), getDisplay: (g) => formatPersonName(g.person) },
    { key: 'location', header: 'Location', type: 'text', getRaw: (g) => g.location || '', getDisplay: (g) => g.location || '' },
    { key: 'itemCode', header: 'Item Code', type: 'text', getRaw: (g) => g.itemCode || '', getDisplay: (g) => g.itemCode || '' },
    { key: 'description', header: 'Description', type: 'text', getRaw: (g) => g.description || '', getDisplay: (g) => g.description || '' },
    { key: 'uom', header: 'UOM', type: 'text', getRaw: (g) => g.uom || '', getDisplay: (g) => g.uom || '' },
    { key: 'unitCost', header: 'Unit Cost', type: 'number', getRaw: (g) => (typeof g.unitCost === 'number' ? g.unitCost : undefined), getDisplay: (g) => formatMoney(g.unitCost) },
    { key: 'quantity', header: 'Quantity', type: 'number', getRaw: (g) => g.quantity, getDisplay: (g) => String(g.quantity ?? '') },
    { key: 'expiryDate', header: 'Expiry Date', type: 'date', getRaw: (g) => g.expiryDate || '', getDisplay: (g) => formatExpiryDisplay(g.expiryDate) },
    { key: 'theoreticalInventory', header: 'System Inventory', type: 'number', getRaw: (g) => (typeof g.theoreticalInventory === 'number' ? g.theoreticalInventory : undefined), getDisplay: (g) => (g.theoreticalInventory === undefined || g.theoreticalInventory === null ? '' : String(g.theoreticalInventory)) },
    { key: 'difference', header: 'Difference', type: 'number', getRaw: (g) => (typeof g.difference === 'number' ? g.difference : undefined), getDisplay: (g) => (g.difference === undefined || g.difference === null ? '' : String(g.difference)) },
    { key: 'differenceCost', header: 'Difference Cost', type: 'number', getRaw: (g) => (typeof g.differenceCost === 'number' ? g.differenceCost : undefined), getDisplay: (g) => (g.differenceCost === undefined || g.differenceCost === null ? '' : formatMoney(g.differenceCost)) },
  ];

  function cellHtml(col, g, idx) {
    if (col.key === 'description') return `${escapeHtml(col.getDisplay(g))}${renderInfoIcon(g.members, idx)}`;
    if (col.key === 'difference') return formatDifference(g.difference);
    if (col.key === 'differenceCost') return formatDifferenceCost(g.differenceCost);
    return escapeHtml(col.getDisplay(g));
  }

  let lastGroups = [];
  let lastRawCount = 0;
  // lastRenderedGroups is what's actually on screen right now (after
  // filtering/sorting) — the merge-breakdown popover below must index into
  // THIS, not lastGroups, since a filtered/sorted row's on-screen position
  // no longer matches its position in the full unfiltered dataset.
  let lastRenderedGroups = [];
  let activeFilters = {}; // { [columnKey]: Set<displayValue> } — a column present here is filtered.
  let activeSort = null; // { key, direction: 'asc' | 'desc' } | null

  function applyFiltersAndSort(groups) {
    let result = groups.filter((g) =>
      Object.keys(activeFilters).every((key) => {
        const col = COLUMNS.find((c) => c.key === key);
        return activeFilters[key].has(col.getDisplay(g));
      })
    );
    if (activeSort) {
      const col = COLUMNS.find((c) => c.key === activeSort.key);
      const withValue = [];
      const blanks = [];
      for (const g of result) {
        const raw = col.getRaw(g);
        (raw === undefined || raw === null || raw === '' ? blanks : withValue).push(g);
      }
      withValue.sort((a, b) => {
        const av = col.getRaw(a);
        const bv = col.getRaw(b);
        if (col.type === 'text') return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
        return av < bv ? -1 : av > bv ? 1 : 0;
      });
      if (activeSort.direction === 'desc') withValue.reverse();
      // Blanks always sort last regardless of direction, matching Excel.
      result = [...withValue, ...blanks];
    }
    return result;
  }

  const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

  function renderTable() {
    const visible = applyFiltersAndSort(lastGroups);
    lastRenderedGroups = visible;
    countsBody.innerHTML = visible.map((g, idx) => `
      <tr>${COLUMNS.map((col) => `<td>${cellHtml(col, g, idx)}</td>`).join('')}<td class="actions-col"><button type="button" class="icon-btn delete-row-btn" data-idx="${idx}" aria-label="Delete">${TRASH_ICON_SVG}</button></td></tr>
    `).join('');
    summaryBar.textContent = Object.keys(activeFilters).length > 0
      ? `${visible.length} of ${lastGroups.length} row(s) shown (filtered).`
      : (lastGroups.length !== lastRawCount
        ? `${lastGroups.length} row(s) counted (from ${lastRawCount} entries).`
        : `${lastGroups.length} row(s) counted.`);
    updateColumnFilterIndicators();
  }

  function loadCounts() {
    fetch('/api/admin/counts')
      .then((r) => r.json())
      .then((rows) => {
        lastGroups = groupCounts(rows);
        lastRawCount = rows.length;
        renderTable();
      });
  }

  function loadItemMeta() {
    fetch('/api/admin/items/meta')
      .then((r) => r.json())
      .then((meta) => {
        if (!meta.uploadedAt) {
          itemMetaNotice.classList.add('stale');
          itemMetaNotice.textContent = meta.clearedAt
            ? `Item list was removed on ${new Date(meta.clearedAt).toLocaleString()}. No one can look up items until a new list is uploaded.`
            : 'No item list has been uploaded yet. Use Upload Item List below.';
          return;
        }
        itemMetaNotice.classList.remove('stale');
        const when = new Date(meta.uploadedAt).toLocaleString();
        itemMetaNotice.textContent = `Item list: ${meta.count} items, last updated ${when}.`;
      });
  }

  btnExport.addEventListener('click', () => {
    window.location.href = '/api/admin/counts/export';
  });

  // Fetches the export as a blob (rather than the simple href-navigation
  // the standalone Export button uses) specifically so this can be awaited —
  // Reset must only proceed once the file has actually finished downloading.
  async function downloadExportBlob() {
    const res = await fetch('/api/admin/counts/export');
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-count-${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  btnReset.addEventListener('click', async () => {
    if (!(await showConfirm('This will export all counts to Excel, then permanently delete them. Continue?', { confirmText: 'Export & Reset', danger: true }))) return;
    try {
      await downloadExportBlob();
    } catch (err) {
      await showAlert('Export failed, so nothing was deleted. Please try again.');
      return;
    }
    if (!(await showConfirm('Excel file downloaded. Permanently delete all counts now? This cannot be undone.', { confirmText: 'Delete all', danger: true }))) return;
    fetch('/api/admin/counts/reset', { method: 'POST' })
      .then(() => loadCounts());
  });

  btnRefresh.addEventListener('click', loadCounts);

  let editMode = false;
  btnEditMode.addEventListener('click', () => {
    editMode = !editMode;
    countsTable.classList.toggle('edit-mode-active', editMode);
    btnEditMode.classList.toggle('btn-toggle-active', editMode);
    btnEditMode.textContent = editMode ? 'Exit Edit Mode' : 'Edit Mode';
  });

  btnClearItems.addEventListener('click', async () => {
    if (!(await showConfirm('This removes the item list from the system. No one will be able to look up or scan items until a new list is uploaded. Continue?', { confirmText: 'Continue', danger: true }))) return;
    if (!(await showConfirm('Are you sure? Submitted counts are not affected, only the item lookup data.', { confirmText: 'Remove list', danger: true }))) return;
    fetch('/api/admin/items/clear', { method: 'POST' })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Failed to remove item list');
        loadItemMeta();
      })
      .catch((err) => showAlert(err.message));
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result is a data URL like "data:...;base64,AAAA" — strip the prefix.
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  fileUpload.addEventListener('change', () => {
    const file = fileUpload.files[0];
    if (!file) return;
    uploadStatus.classList.add('hidden');
    fileToBase64(file)
      .then((base64) => fetch('/api/admin/items/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64 }),
      }))
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Upload failed');
        // No separate success banner — the persistent notice below already
        // updates with the same information, so showing both was redundant.
        uploadStatus.classList.add('hidden');
        loadItemMeta();
      })
      .catch((err) => {
        uploadStatus.classList.remove('hidden', 'status-success');
        uploadStatus.classList.add('status-error');
        uploadStatus.textContent = err.message;
      })
      .finally(() => { fileUpload.value = ''; });
  });

  // ---- Merged-row breakdown popover ----
  // A single shared element positioned with `position: fixed` and JS-computed
  // coordinates, appended directly to <body> — NOT nested inside .table-scroll.
  // That container's overflow-x:auto forces overflow-y to compute to auto too
  // (per the CSS overflow spec), which would silently clip a popover nested
  // inside it on most rows regardless of viewport size.
  const popover = document.createElement('div');
  popover.className = 'info-popover';
  document.body.appendChild(popover);

  function renderPopoverContent(members) {
    const rows = members.map((m) => `
      <tr>
        <td>${escapeHtml(formatDateDisplay(m.date))}</td>
        <td>${escapeHtml(formatPersonName(m.person))}</td>
        <td>${escapeHtml(m.location || '')}</td>
        <td>${m.quantity}</td>
        <td>${escapeHtml(formatExpiryDisplay(m.expiryDate))}</td>
      </tr>
    `).join('');
    popover.innerHTML = `
      <table class="popover-table">
        <thead><tr><th>Date</th><th>Name</th><th>Location</th><th>Qty</th><th>Expiry</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function openPopoverFor(icon) {
    const idx = Number(icon.dataset.idx);
    const group = lastRenderedGroups[idx];
    if (!group) return;
    renderPopoverContent(group.members);

    const r = icon.getBoundingClientRect();
    popover.style.display = 'block';
    let left = Math.min(r.left, window.innerWidth - popover.offsetWidth - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + popover.offsetHeight > window.innerHeight - 8) top = r.top - popover.offsetHeight - 6;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(8, top)}px`;
  }

  function closePopover() {
    popover.style.display = 'none';
  }

  countsBody.addEventListener('mouseover', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) openPopoverFor(icon);
  });
  countsBody.addEventListener('mouseout', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) closePopover();
  });
  countsBody.addEventListener('focusin', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) openPopoverFor(icon);
  });
  countsBody.addEventListener('focusout', (e) => {
    const icon = e.target.closest('.info-icon');
    if (icon) closePopover();
  });
  // Always (re-)opens rather than toggling — a `mouseover` already fires
  // immediately before `click` on both mouse and touch input, so a toggle
  // here would just re-close what mouseover had only just opened.
  countsBody.addEventListener('click', (e) => {
    const icon = e.target.closest('.info-icon');
    if (!icon) return;
    e.preventDefault();
    openPopoverFor(icon);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.info-icon') && !e.target.closest('.info-popover')) closePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
  });
  window.addEventListener('scroll', closePopover, true);
  window.addEventListener('resize', closePopover);

  // ---- Column header sort/filter popup (Excel-style AutoFilter) ----
  // One shared floating element, same reasoning as .info-popover above:
  // nesting this inside a <th> within .table-scroll would get clipped by
  // that container's overflow-x: auto.
  const columnFilterPopup = document.createElement('div');
  columnFilterPopup.className = 'column-filter-popup';
  document.body.appendChild(columnFilterPopup);

  let currentFilterColumnKey = null;
  let pendingSelected = null; // Set<displayValue> being edited until OK/Cancel

  function sortLabels(type) {
    if (type === 'number') return ['Sort Smallest to Largest', 'Sort Largest to Smallest'];
    if (type === 'date') return ['Sort Oldest to Newest', 'Sort Newest to Oldest'];
    return ['Sort A to Z', 'Sort Z to A'];
  }

  // Distinct display values for a column, plus whether any row is blank for
  // it — ordered numerically/chronologically for number/date columns (via
  // getRaw) rather than as plain strings, and alphabetically for text ones.
  function uniqueValuesFor(col) {
    const displayToRaw = new Map();
    let hasBlank = false;
    for (const g of lastGroups) {
      const display = col.getDisplay(g);
      if (display === '') { hasBlank = true; continue; }
      if (!displayToRaw.has(display)) displayToRaw.set(display, col.getRaw(g));
    }
    const values = [...displayToRaw.keys()].sort((a, b) => {
      if (col.type === 'text') return a.localeCompare(b, undefined, { sensitivity: 'base' });
      const ra = displayToRaw.get(a);
      const rb = displayToRaw.get(b);
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });
    return { values, hasBlank };
  }

  function updateSelectAllState() {
    const selectAll = columnFilterPopup.querySelector('[data-role="select-all"]');
    if (!selectAll) return;
    const visibleLabels = [...columnFilterPopup.querySelectorAll('.column-filter-values label')]
      .filter((label) => label.style.display !== 'none');
    const checkboxes = visibleLabels.map((label) => label.querySelector('input'));
    selectAll.checked = checkboxes.length > 0 && checkboxes.every((cb) => cb.checked);
  }

  function renderColumnFilterPopup(col) {
    const { values, hasBlank } = uniqueValuesFor(col);
    const [ascLabel, descLabel] = sortLabels(col.type);
    const active = activeFilters[col.key];
    // Selection starts from whatever filter is already active, or
    // "everything selected" (i.e. unfiltered) if there isn't one yet.
    pendingSelected = active ? new Set(active) : new Set([...values, ...(hasBlank ? [''] : [])]);

    const rowsHtml = [
      ...values.map((v) => ({ value: v, label: v })),
      ...(hasBlank ? [{ value: '', label: '(Blanks)' }] : []),
    ].map(({ value, label }) => `
      <label data-value="${escapeHtml(value)}">
        <input type="checkbox" ${pendingSelected.has(value) ? 'checked' : ''} />
        <span>${escapeHtml(label)}</span>
      </label>
    `).join('');

    columnFilterPopup.innerHTML = `
      <button type="button" class="dropdown-item" data-action="sort-asc">${ascLabel}</button>
      <button type="button" class="dropdown-item" data-action="sort-desc">${descLabel}</button>
      <hr />
      <button type="button" class="dropdown-item" data-action="clear-filter" ${active ? '' : 'disabled'}>Clear Filter</button>
      <hr />
      <input type="text" class="column-filter-search" placeholder="Search" />
      <label class="column-filter-select-all">
        <input type="checkbox" data-role="select-all" />
        <span>(Select All)</span>
      </label>
      <div class="column-filter-values">${rowsHtml}</div>
      <div class="column-filter-actions">
        <button type="button" class="btn btn-primary" data-action="ok">OK</button>
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
      </div>
    `;
    updateSelectAllState();
  }

  function openColumnFilterPopup(columnKey, iconEl) {
    const col = COLUMNS.find((c) => c.key === columnKey);
    if (!col) return;
    currentFilterColumnKey = columnKey;
    renderColumnFilterPopup(col);

    const r = iconEl.getBoundingClientRect();
    columnFilterPopup.classList.add('open');
    let left = Math.min(r.left, window.innerWidth - columnFilterPopup.offsetWidth - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + columnFilterPopup.offsetHeight > window.innerHeight - 8) top = r.top - columnFilterPopup.offsetHeight - 6;
    columnFilterPopup.style.left = `${left}px`;
    columnFilterPopup.style.top = `${Math.max(8, top)}px`;
  }

  // Closing without going through OK (Cancel, outside click, or Escape)
  // always just discards pendingSelected — nothing is applied unless OK
  // was clicked, matching Excel's own AutoFilter dropdown behavior.
  function closeColumnFilterPopup() {
    columnFilterPopup.classList.remove('open');
    currentFilterColumnKey = null;
    pendingSelected = null;
  }

  columnFilterPopup.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    if (action === 'sort-asc' || action === 'sort-desc') {
      activeSort = { key: currentFilterColumnKey, direction: action === 'sort-asc' ? 'asc' : 'desc' };
      closeColumnFilterPopup();
      renderTable();
    } else if (action === 'clear-filter') {
      delete activeFilters[currentFilterColumnKey];
      closeColumnFilterPopup();
      renderTable();
    } else if (action === 'ok') {
      const col = COLUMNS.find((c) => c.key === currentFilterColumnKey);
      const { values, hasBlank } = uniqueValuesFor(col);
      const allValues = new Set([...values, ...(hasBlank ? [''] : [])]);
      const isEverythingSelected = allValues.size === pendingSelected.size
        && [...allValues].every((v) => pendingSelected.has(v));
      if (isEverythingSelected) delete activeFilters[currentFilterColumnKey];
      else activeFilters[currentFilterColumnKey] = new Set(pendingSelected);
      closeColumnFilterPopup();
      renderTable();
    } else if (action === 'cancel') {
      closeColumnFilterPopup();
    }
  });

  columnFilterPopup.addEventListener('change', (e) => {
    if (e.target.matches('.column-filter-values input[type="checkbox"]')) {
      const label = e.target.closest('label');
      if (e.target.checked) pendingSelected.add(label.dataset.value);
      else pendingSelected.delete(label.dataset.value);
      updateSelectAllState();
    } else if (e.target.matches('[data-role="select-all"]')) {
      const visibleLabels = [...columnFilterPopup.querySelectorAll('.column-filter-values label')]
        .filter((label) => label.style.display !== 'none');
      visibleLabels.forEach((label) => {
        label.querySelector('input').checked = e.target.checked;
        if (e.target.checked) pendingSelected.add(label.dataset.value);
        else pendingSelected.delete(label.dataset.value);
      });
    }
  });

  columnFilterPopup.addEventListener('input', (e) => {
    if (!e.target.matches('.column-filter-search')) return;
    const term = e.target.value.trim().toLowerCase();
    columnFilterPopup.querySelectorAll('.column-filter-values label').forEach((label) => {
      label.style.display = label.textContent.trim().toLowerCase().includes(term) ? '' : 'none';
    });
    updateSelectAllState();
  });

  document.querySelector('table.counts-table thead').addEventListener('click', (e) => {
    const btn = e.target.closest('.column-filter-btn');
    if (!btn) return;
    e.stopPropagation();
    openColumnFilterPopup(btn.dataset.column, btn);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.column-filter-popup') && !e.target.closest('.column-filter-btn')) closeColumnFilterPopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeColumnFilterPopup();
  });

  // Reflects which columns currently have an active filter, since the
  // filter icon itself lives in static HTML (rendered once) rather than
  // being rebuilt by renderTable() on every filter/sort change.
  function updateColumnFilterIndicators() {
    document.querySelectorAll('.column-filter-btn').forEach((btn) => {
      btn.classList.toggle('active', Boolean(activeFilters[btn.dataset.column]));
    });
  }

  // ---- Row delete (Edit Mode) ----
  // For a merged row (2+ underlying counts), shows a checklist of which
  // specific ones to delete before confirming — everything else in the app
  // just fires showConfirm directly. Reuses .column-filter-popup's box
  // styling (border/shadow/width/padding) via its own class alongside a
  // second class used only for this popup's own open/close/outside-click
  // logic, kept independent of the real column-filter popup's state.
  const deleteSelectPopup = document.createElement('div');
  deleteSelectPopup.className = 'column-filter-popup delete-select-popup';
  document.body.appendChild(deleteSelectPopup);

  let currentDeleteMembers = null;
  let currentDeleteSelected = null;
  let deleteSelectResolve = null;

  function updateDeleteSelectAllAndOkState() {
    const selectAll = deleteSelectPopup.querySelector('[data-role="select-all"]');
    const okBtn = deleteSelectPopup.querySelector('[data-action="ok"]');
    if (selectAll) selectAll.checked = currentDeleteSelected.size === currentDeleteMembers.length;
    if (okBtn) okBtn.disabled = currentDeleteSelected.size === 0;
  }

  function renderDeleteSelectPopup(members) {
    const rowsHtml = members.map((m) => `
      <label data-id="${escapeHtml(String(m.id))}">
        <input type="checkbox" checked />
        <span>${escapeHtml(formatDateDisplay(m.date))} — ${escapeHtml(formatPersonName(m.person))} — Qty ${m.quantity}</span>
      </label>
    `).join('');
    deleteSelectPopup.innerHTML = `
      <div class="delete-select-heading">Select counts to delete</div>
      <label class="column-filter-select-all">
        <input type="checkbox" data-role="select-all" checked />
        <span>(Select All)</span>
      </label>
      <div class="column-filter-values">${rowsHtml}</div>
      <div class="column-filter-actions">
        <button type="button" class="btn btn-danger" data-action="ok">Delete Selected</button>
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
      </div>
    `;
  }

  // Resolves with the array of selected member ids once "Delete Selected" is
  // clicked, or null if dismissed any other way (Cancel, outside click, Escape).
  function openMemberSelectionPopup(members, anchorEl) {
    return new Promise((resolve) => {
      deleteSelectResolve = resolve;
      currentDeleteMembers = members;
      currentDeleteSelected = new Set(members.map((m) => m.id));
      renderDeleteSelectPopup(members);

      const r = anchorEl.getBoundingClientRect();
      deleteSelectPopup.classList.add('open');
      let left = Math.min(r.left, window.innerWidth - deleteSelectPopup.offsetWidth - 8);
      left = Math.max(8, left);
      let top = r.bottom + 6;
      if (top + deleteSelectPopup.offsetHeight > window.innerHeight - 8) top = r.top - deleteSelectPopup.offsetHeight - 6;
      deleteSelectPopup.style.left = `${left}px`;
      deleteSelectPopup.style.top = `${Math.max(8, top)}px`;
    });
  }

  function closeDeleteSelectPopup(result) {
    deleteSelectPopup.classList.remove('open');
    currentDeleteMembers = null;
    currentDeleteSelected = null;
    if (deleteSelectResolve) {
      const resolve = deleteSelectResolve;
      deleteSelectResolve = null;
      resolve(result);
    }
  }

  deleteSelectPopup.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    if (actionBtn.dataset.action === 'ok') {
      if (currentDeleteSelected.size === 0) return;
      closeDeleteSelectPopup([...currentDeleteSelected]);
    } else if (actionBtn.dataset.action === 'cancel') {
      closeDeleteSelectPopup(null);
    }
  });
  deleteSelectPopup.addEventListener('change', (e) => {
    if (e.target.matches('.column-filter-values input[type="checkbox"]')) {
      const label = e.target.closest('label');
      const member = currentDeleteMembers.find((m) => String(m.id) === label.dataset.id);
      if (!member) return;
      if (e.target.checked) currentDeleteSelected.add(member.id);
      else currentDeleteSelected.delete(member.id);
      updateDeleteSelectAllAndOkState();
    } else if (e.target.matches('[data-role="select-all"]')) {
      if (e.target.checked) currentDeleteMembers.forEach((m) => currentDeleteSelected.add(m.id));
      else currentDeleteSelected.clear();
      deleteSelectPopup.querySelectorAll('.column-filter-values input[type="checkbox"]').forEach((cb) => { cb.checked = e.target.checked; });
      updateDeleteSelectAllAndOkState();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.delete-select-popup')) closeDeleteSelectPopup(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDeleteSelectPopup(null);
  });

  countsBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-row-btn');
    if (!btn) return;
    e.stopPropagation();
    const group = lastRenderedGroups[Number(btn.dataset.idx)];
    if (!group) return;

    let idsToDelete;
    if (group.members.length > 1) {
      idsToDelete = await openMemberSelectionPopup(group.members, btn);
      if (!idsToDelete || idsToDelete.length === 0) return; // cancelled, or nothing selected
    } else {
      idsToDelete = group.members.map((m) => m.id);
    }

    const confirmed = await showConfirm(
      `Delete ${idsToDelete.length} count${idsToDelete.length > 1 ? 's' : ''}? This cannot be undone.`,
      { confirmText: 'Delete', danger: true }
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/admin/counts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      loadCounts();
    } catch (err) {
      showAlert(err.message);
    }
  });

  loadCounts();
  loadItemMeta();
})();
