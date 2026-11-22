// ── Settings reset ───────────────────────────────────────────────────────────
//
// Each user-changeable setting registers itself with
//   registerSetting({ isDefault: () => bool, reset: () => void })
// and fires `settings:changed` when it changes. The navbar reset button shows
// whenever any registered setting differs from its default, and puts them all
// back. New settings (theme, …) only need to register.

const SETTINGS = [];

function refreshSettingsReset() {
  const btn = document.getElementById('settings-reset');
  if (btn) btn.hidden = SETTINGS.every(s => s.isDefault());
}

function registerSetting(setting) {
  SETTINGS.push(setting);
  refreshSettingsReset();
}

window.addEventListener('settings:changed', refreshSettingsReset);

document.getElementById('settings-reset')?.addEventListener('click', e => {
  e.stopPropagation();
  SETTINGS.filter(s => !s.isDefault()).forEach(s => s.reset());
  refreshSettingsReset();
});

function urlSetting(name) {
  return new URLSearchParams(location.search).get(name);
}

function setUrlSetting(name, value) {
  const params = new URLSearchParams(location.search);
  if (value === null || value === undefined) params.delete(name);
  else params.set(name, value);
  const query = params.toString();
  history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash);
}
