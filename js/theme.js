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

  // Where the last click landed: the theme change spreads from there as a circular mask
  let origin = { x: innerWidth / 2, y: innerHeight / 2 };
  addEventListener('pointerdown', e => { origin = { x: e.clientX, y: e.clientY }; }, true);

  let running = null;

  // Changes the theme inside a view transition so the new look is revealed through a growing circle.
  // Browsers without view transitions just switch.
  function reveal(change) {
    if (!document.startViewTransition) { change(); return; }
    if (running) { running.skipTransition(); }
    const { x, y } = origin;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const transition = document.startViewTransition(change);
    running = transition;
    transition.finished.finally(() => { if (running === transition) running = null; });
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  }

  const system = () => (query.matches ? 'light' : 'dark');
  let override = saved();

  query.addEventListener('change', () => { if (!override) apply(system()); });

  document.getElementById('theme-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    override = root.dataset.theme === 'light' ? 'dark' : 'light';
    store(override);
    reveal(() => apply(override));
  });

  registerSetting({
    isDefault: () => !override,
    reset: () => {
      override = null;
      store(null);
      reveal(() => apply(system()));
    },
  });
})();
