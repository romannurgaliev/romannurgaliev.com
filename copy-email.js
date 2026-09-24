// Email: a click copies the address instead of opening a mail app,
// and a toast at the bottom confirms it.
(() => {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML =
    '<svg class="toast-icon" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>' +
    '<span class="toast-text"></span>';
  document.body.append(toast);

  const text = toast.querySelector('.toast-text');
  let timer = 0;

  function show(message) {
    text.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('is-visible'), 2000);
  }

  // Empty the live region once hidden, so the next copy is announced again
  toast.addEventListener('transitionend', () => {
    if (!toast.classList.contains('is-visible')) text.textContent = '';
  });

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // In-app browsers and older engines without the async clipboard
      const focused = document.activeElement;
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;opacity:0';
      document.body.append(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      focused?.focus();
      return ok;
    }
  }

  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-copy]');
    if (!button) return;
    if (await copy(button.dataset.copy)) show('Email copied');
  });
})();
