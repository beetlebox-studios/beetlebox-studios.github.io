// ── Light / dark theme ───────────────────────────────────────────────────────
//
// Follows the system preference by default (and live, when the system changes).
// The navbar button overrides it and remembers the choice; the settings reset
// button drops the override and goes back to following the system.

(function initTheme() {
  const root = document.documentElement;
  const query = matchMedia('(prefers-color-scheme: light)');

  function saved() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }

  function store(value) {
    try {
      if (value) localStorage.setItem('theme', value);
      else localStorage.removeItem('theme');
    } catch (e) { /* storage blocked: the choice just lasts for this visit */ }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    window.dispatchEvent(new Event('theme:changed'));
    window.dispatchEvent(new Event('settings:changed'));
  }

  const system = () => (query.matches ? 'light' : 'dark');
  let override = saved();

  query.addEventListener('change', () => { if (!override) apply(system()); });

  document.getElementById('theme-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    override = root.dataset.theme === 'light' ? 'dark' : 'light';
    store(override);
    apply(override);
  });

  registerSetting({
    isDefault: () => !override,
    reset: () => {
      override = null;
      store(null);
      apply(system());
    },
  });
})();
