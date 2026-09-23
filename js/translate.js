// ── Language picker + Google Translate integration ────────────────────────────
//
// Renders a flag dropdown in the navbar. Selecting a language calls the
// Google Translate Element API to translate the whole page in-place.
// The GT widget itself stays hidden — we drive it programmatically.
//
// Braille is its own entry: a font swap only, no translation.

const LANGUAGES = [
  { code: 'en',    flag: 'us', label: 'English'    },
  { code: 'es',    flag: 'es', label: 'Español'    },
  { code: 'fr',    flag: 'fr', label: 'Français'   },
  { code: 'de',    flag: 'de', label: 'Deutsch'    },
  { code: 'pt',    flag: 'br', label: 'Português'  },
  { code: 'ja',    flag: 'jp', label: '日本語'      },
  { code: 'ko',    flag: 'kr', label: '한국어'      },
  { code: 'zh-CN', flag: 'cn', label: '中文'        },
  { code: 'ar',    flag: 'sa', label: 'العربية'    },
  { code: 'ru',    flag: 'ru', label: 'Русский'    },
  { code: 'hi',    flag: 'in', label: 'हिन्दी'     },
  { code: 'it',    flag: 'it', label: 'Italiano'   },
  { code: 'nl',    flag: 'nl', label: 'Nederlands' },
  { code: 'pl',    flag: 'pl', label: 'Polski'     },
  { code: 'sv',    flag: 'se', label: 'Svenska'    },
  { code: 'tr',    flag: 'tr', label: 'Türkçe'     },
  { code: 'iw',    flag: 'il', label: 'עברית'      },
];

// Font-swap entry — no translation
const BRAILLE = { code: 'braille', icon: 'fa-solid fa-braille', label: 'Braille', font: 'Braille-Regular' };

// ── State ─────────────────────────────────────────────────────────────────────

let currentLang   = 'en';  // active real language code
let brailleStyle  = null;  // <style> tag injected for the Braille font

// ── Google Translate init callback (called by the GT script) ──────────────────

function googleTranslateElementInit() {
  new google.translate.TranslateElement(
    { pageLanguage: 'en', autoDisplay: false },
    'google_translate_element'
  );
}

// ── Apply a language via the GT cookie mechanism ──────────────────────────────

function setLanguage(langCode) {
  currentLang = langCode;

  if (langCode === 'en') {
    document.cookie = 'googtrans=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'googtrans=; path=/; domain=' + location.hostname + '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    location.reload();
    return;
  }

  const value = `/en/${langCode}`;
  document.cookie = `googtrans=${value}; path=/`;
  document.cookie = `googtrans=${value}; path=/; domain=${location.hostname}`;

  const frame = document.querySelector('.goog-te-menu-frame') ||
                document.querySelector('iframe.skiptranslate');
  if (frame) {
    triggerGTSelect(langCode);
  } else {
    location.reload();
  }
}

function triggerGTSelect(langCode) {
  const select = document.querySelector('.goog-te-combo');
  if (!select) { location.reload(); return; }
  select.value = langCode;
  select.dispatchEvent(new Event('change'));
}

// ── Braille font swap ─────────────────────────────────────────────────────────

function applyBraille() {
  clearBraille();
  brailleStyle = document.createElement('style');
  brailleStyle.id = 'braille-font-style';
  brailleStyle.textContent = `body, body *:not(.fa):not(.fas):not(.far):not(.fab):not(.fal):not(.fad):not([class*="fa-"]):not(.lang-option-label) { font-family: '${BRAILLE.font}', sans-serif !important; }`;
  document.head.appendChild(brailleStyle);
}

function clearBraille() {
  if (brailleStyle) { brailleStyle.remove(); brailleStyle = null; }
}

// ── Build the dropdown UI ─────────────────────────────────────────────────────

(function buildUI() {
  const btn      = document.getElementById('lang-btn');
  const btnFlag  = document.getElementById('lang-btn-flag');
  const dropdown = document.getElementById('lang-dropdown');
  const wrap     = document.getElementById('lang-wrap');

  // Detect active lang from cookie
  const match = document.cookie.match(/googtrans=\/en\/([^;]+)/);
  if (match) currentLang = decodeURIComponent(match[1]);

  function makeOption(code, iconClass, label) {
    const row = document.createElement('button');
    row.className    = 'lang-option';
    row.role         = 'option';
    row.dataset.code = code;
    row.setAttribute('aria-selected', 'false');

    const icon = document.createElement(iconClass.startsWith('fi ') ? 'span' : 'i');
    icon.className = iconClass;

    const name = document.createElement('span');
    name.className   = 'lang-option-label';
    name.textContent = label;

    row.appendChild(icon);
    row.appendChild(name);
    dropdown.appendChild(row);
    return row;
  }

  LANGUAGES.forEach(lang => {
    const row = makeOption(lang.code, `fi fi-${lang.flag}`, lang.label);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      clearBraille();
      updateSelected(lang.code);
      updateButtonFlag(lang);
      // Re-picking the active language only needs to drop Braille
      if (lang.code !== currentLang) setLanguage(lang.code);
      closeDropdown();
    });
  });

  const brailleRow = makeOption(BRAILLE.code, `${BRAILLE.icon} lang-icon`, BRAILLE.label);
  brailleRow.addEventListener('click', (e) => {
    e.stopPropagation();
    applyBraille();
    updateSelected(BRAILLE.code);
    updateButtonIcon(BRAILLE);
    closeDropdown();
  });

  // Set initial button state
  const activeLang = LANGUAGES.find(l => l.code === currentLang) || LANGUAGES[0];
  updateSelected(activeLang.code);
  updateButtonFlag(activeLang);

  // Toggle dropdown open/close
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !wrap.classList.contains('lang-open');
    closeOtherPanels('lang-wrap');
    wrap.classList.toggle('lang-open', opening);
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });

  document.addEventListener('click', () => closeDropdown());
  dropdown.addEventListener('click', e => e.stopPropagation());

  function closeDropdown() {
    wrap.classList.remove('lang-open');
    btn.setAttribute('aria-expanded', 'false');
  }

  function updateSelected(code) {
    dropdown.querySelectorAll('.lang-option').forEach(opt => {
      opt.setAttribute('aria-selected', opt.dataset.code === code ? 'true' : 'false');
    });
  }

  function updateButtonFlag(lang) {
    btnFlag.className = `fi fi-${lang.flag} lang-btn-flag`;
  }

  function updateButtonIcon(entry) {
    btnFlag.className = `${entry.icon} lang-btn-flag lang-btn-flag--icon`;
  }
})();
