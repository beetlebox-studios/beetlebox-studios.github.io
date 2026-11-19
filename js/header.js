(function () {
  const script = document.currentScript;
  const root = new URL('../', script.src).href;
  const standalone = script.hasAttribute('data-standalone');

  const markup = `
  <div class="navbar-inner">
    <a href="${standalone ? root : '#'}" class="navbar-logo" aria-label="BeetleBox Studios"><span class="navbar-logo-mark"></span></a>
    <div class="navbar-actions">
      <span class="admin-only admin-pill">Admin</span>
      <div class="lang-wrap" id="lang-wrap">
        <button class="icon-btn lang-btn" id="lang-btn" aria-label="Select language" aria-expanded="false" aria-haspopup="listbox">
          <span class="fi fi-un lang-btn-flag" id="lang-btn-flag"></span>
        </button>
        <div class="lang-dropdown" id="lang-dropdown" role="listbox" aria-label="Language"></div>
      </div>
      <div id="google_translate_element" style="display:none"></div>
      <div class="accent-wrap" id="accent-wrap">
        <button class="icon-btn accent-btn" id="accent-btn" aria-label="Change accent color">
          <span class="accent-orb" id="accent-orb"></span>
        </button>
        <div class="accent-popup" id="accent-popup">
          <input type="range" id="hue-slider" class="hue-slider" min="0" max="1000" step="1" value="500" />
          <button class="icon-btn accent-reset-btn" id="accent-reset-btn" aria-label="Reset accent color">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
        </div>
      </div>
      <div class="search-wrap" id="search-wrap">
        <input type="text" id="search-input" placeholder="Search..." autocomplete="off" aria-label="Search page" />
        <span id="search-count"></span>
        <button class="icon-btn" id="search-btn" aria-label="Search">
          <i class="fa-solid fa-magnifying-glass"></i>
        </button>
      </div>
    </div>
  </div>`;

  let header = document.getElementById('navbar');
  if (!header) {
    header = document.createElement('header');
    header.id = 'navbar';
    document.body.prepend(header);
  }
  header.innerHTML = markup;

  if (!standalone) return;

  const styles = [
    'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/css/flag-icons.min.css',
    root + 'css/header.css',
  ];
  header.style.visibility = 'hidden';
  for (const href of styles) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (href.endsWith('header.css')) link.onload = link.onerror = () => (header.style.visibility = '');
    document.head.appendChild(link);
  }
  if (!document.querySelector('link[rel="icon"]')) {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }

  const deps = ['js/main.js', 'js/search.js', 'js/accent.js', 'js/translate.js'].map(p => root + p);
  deps.push('https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit');
  (function next(i) {
    if (i >= deps.length) return;
    const s = document.createElement('script');
    s.src = deps[i];
    s.onload = () => next(i + 1);
    document.body.appendChild(s);
  })(0);
})();
