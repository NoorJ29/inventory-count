// Small centered-card confirm/alert dialogs, replacing native confirm()/alert()
// so they match the app's own look instead of the browser's generic popup.
// Exposes window.showConfirm(message, opts) -> Promise<boolean>
// and window.showAlert(message, opts) -> Promise<void>.
(function () {
  const overlay = document.createElement('div');
  overlay.id = 'dialogOverlay';
  overlay.className = 'dialog-overlay hidden';
  overlay.innerHTML = `
    <div class="dialog-card">
      <div id="dialogMessage" class="dialog-message"></div>
      <div id="dialogButtons" class="dialog-buttons"></div>
    </div>
  `;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
  if (document.readyState !== 'loading') document.body.appendChild(overlay);

  const dialogMessage = overlay.querySelector('#dialogMessage');
  const dialogButtons = overlay.querySelector('#dialogButtons');

  function open(message, buttons) {
    return new Promise((resolve) => {
      dialogMessage.textContent = message;
      dialogButtons.innerHTML = '';
      buttons.forEach(({ label, value, variant }) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = `btn dialog-btn ${variant || 'btn-secondary'}`;
        btn.addEventListener('click', () => {
          overlay.classList.add('hidden');
          resolve(value);
        });
        dialogButtons.appendChild(btn);
      });
      overlay.classList.remove('hidden');
    });
  }

  window.showConfirm = function showConfirm(message, opts) {
    opts = opts || {};
    return open(message, [
      { label: opts.cancelText || 'Cancel', value: false, variant: 'btn-secondary' },
      { label: opts.confirmText || 'Continue', value: true, variant: opts.danger ? 'btn-danger' : 'btn-primary' },
    ]);
  };

  window.showAlert = function showAlert(message, opts) {
    opts = opts || {};
    return open(message, [{ label: opts.okText || 'OK', value: undefined, variant: 'btn-primary' }]);
  };
})();
