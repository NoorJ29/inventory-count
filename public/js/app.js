(function () {
  const LS_NAME = 'invsys_person';
  const LS_LOCATION = 'invsys_location';
  const LS_LIST = 'invsys_worklist';

  const screenName = document.getElementById('screen-name');
  const screenCount = document.getElementById('screen-count');
  const personNameInput = document.getElementById('personName');
  const locationSelect = document.getElementById('locationSelect');
  const btnStart = document.getElementById('btnStart');
  const personLabel = document.getElementById('personLabel');
  const locationLabel = document.getElementById('locationLabel');
  const rowSwitchUser = document.getElementById('rowSwitchUser');
  const rowEditLocation = document.getElementById('rowEditLocation');

  const btnAddItem = document.getElementById('btnAddItem');
  const itemList = document.getElementById('itemList');
  const emptyState = document.getElementById('emptyState');
  const btnSubmit = document.getElementById('btnSubmit');

  const scanModal = document.getElementById('scanModal');
  const btnCloseScan = document.getElementById('btnCloseScan');
  const reader = document.getElementById('reader');
  const manualCode = document.getElementById('manualCode');
  const btnManualLookup = document.getElementById('btnManualLookup');
  const scanError = document.getElementById('scanError');

  const itemModal = document.getElementById('itemModal');
  const btnCloseItem = document.getElementById('btnCloseItem');
  const itemModalTitle = document.getElementById('itemModalTitle');
  const detCode = document.getElementById('detCode');
  const detDesc = document.getElementById('detDesc');
  const detUom = document.getElementById('detUom');
  const detLocation = document.getElementById('detLocation');
  const detQty = document.getElementById('detQty');
  const detExpiry = document.getElementById('detExpiry');
  const btnClearExpiry = document.getElementById('btnClearExpiry');
  const itemModalError = document.getElementById('itemModalError');
  const btnAddToList = document.getElementById('btnAddToList');

  const itemStatusBadge = document.getElementById('itemStatusBadge');
  const itemStatusText = document.getElementById('itemStatusText');

  const btnInstallApp = document.getElementById('btnInstallApp');

  let workList = [];
  let currentItem = null; // item looked up, pending quantity entry
  let editIndex = null; // index in workList being edited, or null if adding new
  let html5QrCode = null;
  let scannerRunning = false;
  let currentLocation = null; // single live session-level location value

  // Expiry date input mask state: the DD/MM/YYYY template stays on screen at
  // all times, with typed digits filling its slots in order (like a card
  // expiry field) rather than a placeholder that disappears once you type.
  let expiryDigits = [];
  const EXPIRY_MASK_TEMPLATE = ['D', 'D', '/', 'M', 'M', '/', 'Y', 'Y', 'Y', 'Y'];
  const EXPIRY_SLOTS = [0, 1, 3, 4, 6, 7, 8, 9];

  function loadLocations() {
    return fetch('/api/locations')
      .then((r) => r.json())
      .then((locations) => {
        locationSelect.innerHTML = '<option value="" disabled>Select location…</option>' +
          locations.map((loc) => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join('');
      });
  }

  // Always lands on the name/location screen on load (never auto-jumps
  // straight into a counting session from a previous visit) — the location
  // dropdown always starts blank so the person has to actively pick where
  // they're counting each time, but the name is still remembered as a
  // convenience since it's the same person opening the app again.
  function loadState() {
    const savedName = localStorage.getItem(LS_NAME);
    const savedList = localStorage.getItem(LS_LIST);
    if (savedList) {
      try { workList = JSON.parse(savedList); } catch (e) { workList = []; }
    }
    if (savedName) {
      personNameInput.value = savedName;
    }
    // Browsers restore a <select>'s previous value on reload on their own,
    // independent of anything above — force it back to blank so it can't
    // silently carry a stale location into a new session.
    locationSelect.value = '';
  }

  function saveList() {
    localStorage.setItem(LS_LIST, JSON.stringify(workList));
  }

  function loadItemStatus() {
    fetch('/api/items/status')
      .then((r) => r.json())
      .then((status) => {
        itemStatusBadge.classList.remove('hidden');
        if (status.available) {
          itemStatusBadge.classList.add('available');
          itemStatusBadge.classList.remove('unavailable');
          itemStatusText.textContent = 'Ready to scan';
        } else {
          itemStatusBadge.classList.add('unavailable');
          itemStatusBadge.classList.remove('available');
          itemStatusText.textContent = 'No item list loaded — contact an admin before counting';
        }
      })
      .catch(() => {
        itemStatusBadge.classList.remove('hidden', 'available');
        itemStatusBadge.classList.add('unavailable');
        itemStatusText.textContent = 'Could not check item list status';
      });
  }

  function showCountScreen(name, location) {
    personLabel.textContent = name;
    currentLocation = location;
    locationLabel.textContent = location;
    screenName.classList.add('hidden');
    screenCount.classList.remove('hidden');
    renderList();
  }

  btnStart.addEventListener('click', () => {
    const name = personNameInput.value.trim();
    const location = locationSelect.value;
    if (!name) { personNameInput.focus(); return; }
    if (!location) { locationSelect.focus(); return; }
    localStorage.setItem(LS_NAME, name);
    localStorage.setItem(LS_LOCATION, location);
    showCountScreen(name, location);
  });

  // The whole row acts as the button (not just the small icon) — bind both
  // click and Enter/Space so it's reachable by keyboard too, since these are
  // plain divs with role="button" rather than real <button> elements.
  function bindActionRow(el, handler) {
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  }

  bindActionRow(rowSwitchUser, async () => {
    if (workList.length && !(await showConfirm('Switching user will keep your current uncounted list. Continue?'))) return;
    localStorage.removeItem(LS_NAME);
    screenCount.classList.add('hidden');
    screenName.classList.remove('hidden');
  });

  bindActionRow(rowEditLocation, () => {
    screenCount.classList.add('hidden');
    screenName.classList.remove('hidden');
    personNameInput.value = localStorage.getItem(LS_NAME) || '';
    locationSelect.value = currentLocation || '';
  });

  function renderList() {
    itemList.innerHTML = '';
    if (workList.length === 0) {
      emptyState.classList.remove('hidden');
      btnSubmit.classList.add('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    btnSubmit.classList.remove('hidden');

    workList.forEach((row, idx) => {
      const li = document.createElement('li');
      li.className = 'item-row';
      li.innerHTML = `
        <div class="row-top">
          <span class="code">${escapeHtml(row.itemCode)}</span>
        </div>
        <div class="desc">${escapeHtml(row.description)}</div>
        <div class="meta">
          <span>UOM: ${escapeHtml(row.uom)}</span>
          <span class="qty">Qty: ${row.quantity}</span>
        </div>
        <div class="meta">
          <span>Location: ${escapeHtml(currentLocation || '')}</span>
          <span>${row.expiryDate ? 'Exp: ' + escapeHtml(row.expiryDate) : ''}</span>
        </div>
        <div class="row-actions">
          <button data-action="edit" data-idx="${idx}">Edit</button>
          <button data-action="delete" data-idx="${idx}" class="danger">Delete</button>
        </div>
      `;
      itemList.appendChild(li);
    });
  }

  itemList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (btn.dataset.action === 'delete') {
      if (!(await showConfirm('Remove this item from the list?', { confirmText: 'Remove', danger: true }))) return;
      workList.splice(idx, 1);
      saveList();
      renderList();
    } else if (btn.dataset.action === 'edit') {
      openEditForRow(idx);
    }
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Add item flow ----
  btnAddItem.addEventListener('click', () => {
    editIndex = null;
    loadItemStatus();
    openScanModal();
  });

  function openScanModal() {
    scanError.classList.add('hidden');
    manualCode.value = '';
    scanModal.classList.remove('hidden');
    startScanner();
  }

  function closeScanModal() {
    scanModal.classList.add('hidden');
    stopScanner();
  }
  btnCloseScan.addEventListener('click', closeScanModal);

  function startScanner() {
    if (scannerRunning) return;
    html5QrCode = new Html5Qrcode('reader');
    const config = { fps: 10, qrbox: { width: 250, height: 120 } };
    html5QrCode.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        onCodeScanned(decodedText);
      },
      () => { /* ignore per-frame scan failures */ }
    ).then(() => {
      scannerRunning = true;
    }).catch((err) => {
      scanError.textContent = 'Camera unavailable: ' + err + '. You can still enter the code manually below.';
      scanError.classList.remove('hidden');
    });
  }

  function stopScanner() {
    if (html5QrCode && scannerRunning) {
      html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
    }
    scannerRunning = false;
    html5QrCode = null;
  }

  function onCodeScanned(code) {
    stopScanner();
    scanModal.classList.add('hidden');
    lookupAndShow(code);
  }

  btnManualLookup.addEventListener('click', () => {
    const code = manualCode.value.trim();
    if (!code) return;
    stopScanner();
    scanModal.classList.add('hidden');
    lookupAndShow(code);
  });

  function lookupAndShow(code) {
    fetch('/api/items/' + encodeURIComponent(code))
      .then((r) => {
        if (!r.ok) throw new Error('Item code not found: ' + code);
        return r.json();
      })
      .then((item) => {
        currentItem = item;
        showItemModal(
          item,
          editIndex !== null ? workList[editIndex].quantity : '',
          editIndex !== null ? workList[editIndex].expiryDate : ''
        );
      })
      .catch(async (err) => {
        await showAlert(err.message);
        openScanModal();
      });
  }

  function showItemModal(item, qtyValue, expiryValue) {
    itemModalTitle.textContent = editIndex !== null ? 'Edit Item' : 'Item Found';
    detCode.textContent = item.code;
    detDesc.textContent = item.description || '(no description)';
    detUom.textContent = item.uom || '-';
    detLocation.textContent = currentLocation || '-';
    detQty.value = qtyValue === undefined ? '' : qtyValue;
    setExpiryDigits(expiryValue);
    itemModalError.classList.add('hidden');
    itemModal.classList.remove('hidden');
    setTimeout(() => detQty.focus(), 50);
  }

  // Mobile keyboards show this as "Go"/"Done"/"Next" for a numeric input —
  // same fix as the expiry field below, so either field can submit the item.
  detQty.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnAddToList.click();
    }
  });

  // ---- Expiry date input mask ----
  // The DD/MM/YYYY template is always the displayed value; typed digits
  // overwrite its slots in order and the cursor is kept pinned to the next
  // fillable slot, so the format label never disappears while typing.
  function renderExpiryMask() {
    const chars = EXPIRY_MASK_TEMPLATE.slice();
    EXPIRY_SLOTS.forEach((pos, i) => {
      if (expiryDigits[i] !== undefined) chars[pos] = expiryDigits[i];
    });
    return chars.join('');
  }

  function nextExpiryCursorPos() {
    return expiryDigits.length < 8 ? EXPIRY_SLOTS[expiryDigits.length] : 10;
  }

  function refreshExpiryDisplay() {
    detExpiry.value = renderExpiryMask();
    btnClearExpiry.classList.toggle('hidden', expiryDigits.length === 0);
  }

  function setExpiryDigits(value) {
    const raw = String(value || '').replace(/\D/g, '').slice(0, 8);
    expiryDigits = raw.split('');
    refreshExpiryDisplay();
  }

  function moveExpiryCursorToFillPosition() {
    setTimeout(() => {
      const pos = nextExpiryCursorPos();
      detExpiry.setSelectionRange(pos, pos);
    }, 0);
  }

  btnClearExpiry.addEventListener('click', () => {
    setExpiryDigits('');
    detExpiry.focus();
  });

  detExpiry.addEventListener('focus', moveExpiryCursorToFillPosition);
  detExpiry.addEventListener('click', moveExpiryCursorToFillPosition);

  detExpiry.addEventListener('keydown', (e) => {
    const navKeys = ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (navKeys.includes(e.key) || e.ctrlKey || e.metaKey) return;

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      if (expiryDigits.length < 8) {
        expiryDigits.push(e.key);
        refreshExpiryDisplay();
        detExpiry.setSelectionRange(nextExpiryCursorPos(), nextExpiryCursorPos());
      }
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (expiryDigits.length > 0) {
        expiryDigits.pop();
        refreshExpiryDisplay();
        detExpiry.setSelectionRange(nextExpiryCursorPos(), nextExpiryCursorPos());
      }
      return;
    }
    if (e.key === 'Enter') {
      // Mobile keyboards show this as "Go"/"Done" for numeric/date-like
      // inputs — without this it was being silently swallowed below along
      // with every other non-digit key.
      e.preventDefault();
      btnAddToList.click();
      return;
    }
    e.preventDefault(); // block any other typed character
  });

  detExpiry.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    setExpiryDigits(pasted);
    detExpiry.setSelectionRange(nextExpiryCursorPos(), nextExpiryCursorPos());
  });

  function parseDisplayDate(str) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (year < 1900 || year > 2100) return null;
    return { day, month, year };
  }

  function displayDateToIso(str) {
    const parsed = parseDisplayDate(str);
    if (!parsed) return '';
    const mm = String(parsed.month).padStart(2, '0');
    const dd = String(parsed.day).padStart(2, '0');
    return `${parsed.year}-${mm}-${dd}`;
  }

  btnCloseItem.addEventListener('click', () => {
    itemModal.classList.add('hidden');
    currentItem = null;
    editIndex = null;
  });

  btnAddToList.addEventListener('click', () => {
    const qty = Number(detQty.value);
    if (detQty.value.trim() === '' || Number.isNaN(qty) || qty < 0) {
      itemModalError.textContent = 'Please enter a valid quantity (0 or more).';
      itemModalError.classList.remove('hidden');
      return;
    }

    let expiryDateDisplay = '';
    if (expiryDigits.length > 0) {
      const currentExpiryValue = renderExpiryMask();
      if (expiryDigits.length < 8 || !parseDisplayDate(currentExpiryValue)) {
        itemModalError.textContent = 'Please enter a valid expiry date (DD/MM/YYYY) or leave it blank.';
        itemModalError.classList.remove('hidden');
        return;
      }
      expiryDateDisplay = currentExpiryValue;
    }

    const row = {
      itemCode: currentItem.code,
      description: currentItem.description,
      uom: currentItem.uom,
      quantity: qty,
      expiryDate: expiryDateDisplay,
      theoreticalInventory: Number(currentItem.theoreticalInventory) || 0,
    };
    if (editIndex !== null) {
      workList[editIndex] = row;
    } else {
      workList.push(row);
    }
    saveList();
    renderList();
    itemModal.classList.add('hidden');
    currentItem = null;
    editIndex = null;
  });

  function openEditForRow(idx) {
    editIndex = idx;
    const row = workList[idx];
    currentItem = { code: row.itemCode, description: row.description, uom: row.uom, theoreticalInventory: row.theoreticalInventory };
    showItemModal(currentItem, row.quantity, row.expiryDate);
  }

  // ---- Submit ----
  // The server may run in a different timezone (Cloudflare Workers run in
  // UTC), so the submitting phone's own local calendar date is sent along
  // rather than letting the server derive "today" from its own clock —
  // otherwise a submission made late at night reads as the wrong day.
  function localDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  btnSubmit.addEventListener('click', () => {
    if (workList.length === 0) return;
    const name = localStorage.getItem(LS_NAME);
    const location = localStorage.getItem(LS_LOCATION);
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting...';
    const payloadItems = workList.map((row) => ({
      itemCode: row.itemCode,
      description: row.description,
      uom: row.uom,
      quantity: row.quantity,
      expiryDate: row.expiryDate ? displayDateToIso(row.expiryDate) : '',
      theoreticalInventory: row.theoreticalInventory,
    }));
    fetch('/api/counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person: name, location, date: localDateString(), items: payloadItems }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(async ({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Submit failed');
        workList = [];
        saveList();
        renderList();
        await showAlert(`Submitted ${data.added} item(s). Thank you!`);
      })
      .catch((err) => showAlert(err.message))
      .finally(() => {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Count';
      });
  });

  loadLocations().then(loadState);
  loadItemStatus();

  // Chrome/Edge/Android fire this instead of showing their own install UI
  // once we call preventDefault() on it, so we can trigger the same native
  // prompt from our own button instead — never fires on iOS Safari or once
  // already installed, so the button just stays hidden there.
  let deferredInstallPrompt = null;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  if (!isStandalone) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      btnInstallApp.classList.remove('hidden');
    });
  }
  btnInstallApp.addEventListener('click', () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => {
      deferredInstallPrompt = null;
      btnInstallApp.classList.add('hidden');
    });
  });
  window.addEventListener('appinstalled', () => {
    btnInstallApp.classList.add('hidden');
  });
})();
