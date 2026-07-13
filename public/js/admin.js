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

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Used for both the submission Date and the Expiry Date columns, so the
  // two read consistently instead of one being ISO and the other DD/MM/YYYY.
  function formatDateDisplay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
  }

  // Keep in sync with src/formatPersonName.js — standardizes a free-text
  // name for display (first letter of each word capitalized, rest
  // lowercase) regardless of how it was typed. Raw stored data is untouched.
  function formatPersonName(name) {
    return String(name || '').trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatDifference(diff) {
    if (diff === undefined || diff === null || diff === '') return '';
    if (diff > 0) return `<span class="diff-positive">+${diff}</span>`;
    if (diff < 0) return `<span class="diff-negative">${diff}</span>`;
    return `<span class="diff-zero">${diff}</span>`;
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
      for (const m of group.members) {
        if (typeof m.theoreticalInventory === 'number' && Number.isFinite(m.theoreticalInventory)) {
          theoreticalInventory = m.theoreticalInventory;
        }
      }
      const difference = typeof theoreticalInventory === 'number'
        ? group.quantity - theoreticalInventory
        : undefined;
      const expiryDates = group.members.map((m) => m.expiryDate).filter(Boolean).sort();
      return { ...group, theoreticalInventory, difference, expiryDate: expiryDates[0] || '' };
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

  let lastGroups = [];

  function loadCounts() {
    fetch('/api/admin/counts')
      .then((r) => r.json())
      .then((rows) => {
        const grouped = groupCounts(rows);
        lastGroups = grouped;
        countsBody.innerHTML = grouped.map((g, idx) => `
          <tr>
            <td>${escapeHtml(formatDateDisplay(g.date))}</td>
            <td>${escapeHtml(formatPersonName(g.person))}</td>
            <td>${escapeHtml(g.location || '')}</td>
            <td>${escapeHtml(g.itemCode)}</td>
            <td>${escapeHtml(g.description)}${renderInfoIcon(g.members, idx)}</td>
            <td>${escapeHtml(g.uom)}</td>
            <td>${escapeHtml(formatDateDisplay(g.expiryDate))}</td>
            <td>${g.quantity}</td>
            <td>${g.theoreticalInventory ?? ''}</td>
            <td>${formatDifference(g.difference)}</td>
          </tr>
        `).join('');
        summaryBar.textContent = grouped.length !== rows.length
          ? `${grouped.length} row(s) counted (from ${rows.length} entries).`
          : `${grouped.length} row(s) counted.`;
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
        <td>${escapeHtml(formatDateDisplay(m.expiryDate))}</td>
        <td>${m.quantity}</td>
      </tr>
    `).join('');
    popover.innerHTML = `
      <table class="popover-table">
        <thead><tr><th>Date</th><th>Name</th><th>Location</th><th>Expiry</th><th>Qty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function openPopoverFor(icon) {
    const idx = Number(icon.dataset.idx);
    const group = lastGroups[idx];
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

  loadCounts();
  loadItemMeta();
})();
