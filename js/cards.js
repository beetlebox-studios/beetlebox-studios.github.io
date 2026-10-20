// ── CardGrid — generalized data-driven card renderer ─────────────────────────
//
// Usage:
//   new CardGrid({ src, target, type })
//
// JSON shape — game:
//   { title, meta, status, description, image, secret, gif, jam: { label, logo }, credits: ["Name", …],
//     links: { play, itch, steam, trailer, github } }
//
// The game card's filter button cross-references the team network (team.js)
// by name via the shared GRID_REGISTRY.

// ── Shared state ─────────────────────────────────────────────────────────────

// Maps grid-id → array of { item, cardEl } after each grid loads.
const GRID_REGISTRY = {};

// Active filter state
let activeFilter    = null;  // game title string, or null for "show all"
let activeFilterBtn = null;  // the DOM button that set the active filter

// ── CardGrid class ────────────────────────────────────────────────────────────

class CardGrid {
  constructor({ src, target, type }) {
    this.src    = src;
    this.target = target;
    this.type   = type;
    this._init();
  }

  async _init() {
    const grid = document.getElementById(this.target);
    if (!grid) return;

    let items;
    try {
      const res = await fetch(this.src);
      items = await res.json();
    } catch (e) {
      console.warn(`CardGrid: failed to load ${this.src}`, e);
      return;
    }

    const def = CARD_TYPES[this.type];
    if (!def) { console.warn(`CardGrid: unknown type "${this.type}"`); return; }

    // Register entries so other grids can look them up
    GRID_REGISTRY[this.target] = [];

    items.filter(isVisible).forEach((item, i) => {
      const card = def.buildCard(item, i);
      if (item.draft) card.classList.add('is-draft');
      GRID_REGISTRY[this.target].push({ item, card });
      grid.appendChild(card);
    });
  }
}

// ── Filter logic ──────────────────────────────────────────────────────────────

function applyFilter(gameTitle, credits, btn) {
  const peopleEntries = GRID_REGISTRY['people-grid'];
  if (!peopleEntries) return;

  const creditSet = new Set((credits ?? []).map(n => n.toLowerCase()));
  const isFilterOn = !!gameTitle;

  // Reset the previously active button before updating state
  if (activeFilterBtn) {
    activeFilterBtn.classList.remove('game-filter-btn--active');
    activeFilterBtn = null;
  }

  activeFilter = gameTitle ?? null;

  // Mark the new button active (if there is one)
  if (isFilterOn && btn) {
    btn.classList.add('game-filter-btn--active');
    activeFilterBtn = btn;
  }

  const peopleGrid = document.getElementById('people-grid');
  peopleGrid.classList.toggle('people-grid--filtered', isFilterOn);

  peopleEntries.forEach(({ item, card }) => {
    const match = !isFilterOn || creditSet.has(item.name.toLowerCase());
    card.classList.toggle('person-card--hidden', !match);
  });

  updateFilterBanner(gameTitle);

  if (isFilterOn) {
    document.getElementById('people')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateFilterBanner(gameTitle) {
  const existing = document.getElementById('people-filter-banner');

  if (!gameTitle) {
    existing?.remove();
    return;
  }

  const banner = existing ?? (() => {
    const b = el('div', 'people-filter-banner');
    b.id = 'people-filter-banner';
    const section = document.getElementById('people');
    section.querySelector('.section-inner')?.prepend(b);
    return b;
  })();

  banner.innerHTML = '';

  const label = el('span', 'people-filter-label');
  label.textContent = `Filtered: ${gameTitle}`;
  banner.appendChild(label);

  const clearBtn = el('button', 'people-filter-clear');
  clearBtn.setAttribute('aria-label', 'Clear filter');
  clearBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Show all';
  clearBtn.addEventListener('click', () => applyFilter(null, null, null));
  banner.appendChild(clearBtn);
}

// ── Card type definitions ─────────────────────────────────────────────────────

const CARD_TYPES = {

  // ── Game card ────────────────────────────────────────────────────────────────
  game: {
    buildCard(item, i) {
      const card = el('div', 'work-card card-base onload-animation');
      card.style.setProperty('--delay', `${i * 60}ms`);

      // ── Image wrap
      const imgWrap = el('div', 'work-img-wrap');

      // Static thumbnail — always present as the base layer
      if (item.image) {
        imgWrap.appendChild(makeImg(item.image, item.title, item.secret ? 'work-img work-img--secret' : 'work-img'));
      }
      imgWrap.appendChild(el('div', 'work-placeholder-bg'));

      // GIF preview — sits above thumbnail, hidden until hover.
      // src is left empty and only assigned on mouseenter so the GIF
      // starts from frame 1 each time (browsers restart a GIF when src is set).
      // On mouseleave src is cleared, stopping playback and freeing memory.
      if (item.gif && !item.secret) {
        const gifEl = makeImg('', item.title, 'work-gif');
        gifEl.setAttribute('aria-hidden', 'true');
        card.addEventListener('mouseenter', () => { gifEl.src = item.gif; });
        card.addEventListener('mouseleave', () => { gifEl.src = ''; });
        imgWrap.appendChild(gifEl);
      }

      // ── Overlay buttons (top-right of image): team filter
      const btnWrap = el('div', 'game-img-btns');

      if (Array.isArray(item.credits)) {
        const filterBtn = el('button', 'game-img-btn');
        filterBtn.setAttribute('aria-label', `Filter team by ${item.title}`);
        filterBtn.innerHTML = '<i class="fa-solid fa-users"></i>';
        filterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeFilter === item.title) {
            applyFilter(null, null, null);
          } else {
            applyFilter(item.title, item.credits, filterBtn);
          }
        });
        btnWrap.appendChild(filterBtn);
      }

      if (btnWrap.children.length) imgWrap.appendChild(btnWrap);

      // ── Jam badge (bottom-right fade) — jam logo image if provided, else label text
      if (item.jam) {
        const badge = el('div', 'work-jam-badge');
        const label = text('span', 'work-jam-label', item.jam.label || 'JAM');
        if (item.jam.logo) {
          const logo = makeImg(item.jam.logo, item.jam.label || 'Jam', 'work-jam-logo');
          logo.addEventListener('error', () => logo.replaceWith(label));
          badge.appendChild(logo);
        } else {
          badge.appendChild(label);
        }
        imgWrap.appendChild(badge);
      }

      if (item.draft) {
        const draft = text('span', 'work-status work-draft-badge', 'Draft');
        draft.dataset.status = 'draft';
        imgWrap.appendChild(draft);
      }

      // ── Info
      const info = el('div', 'work-info');
      const titleRow = el('div', 'work-title-row');
      titleRow.appendChild(text('p', 'work-title', item.title));
      if (item.status) {
        const status = text('span', 'work-status', item.status);
        status.dataset.status = item.status.toLowerCase().replace(/\s+/g, '-');
        titleRow.appendChild(status);
      }
      info.appendChild(titleRow);
      info.appendChild(text('p', 'work-meta',  item.meta));
      if (item.description) {
        info.appendChild(text('p', 'work-desc', item.description));
      }

      // Playable in the browser — whole card opens the game page
      if (item.links?.play) {
        info.appendChild(playLink(item, 'work-play'));
      }
      const target = item.links?.itch || item.links?.steam || item.links?.play;
      if (target) {
        card.addEventListener('click', () => { location.href = target; });
      }

      const linkDefs = [
        { key: 'trailer', icon: 'fa-brands fa-youtube',  label: 'Trailer' },
        { key: 'github',  icon: 'fa-brands fa-github',   label: 'GitHub' },
      ];
      const linksEl = buildLinks(item.links, linkDefs, 'work-links');
      if (linksEl) info.appendChild(linksEl);

      card.appendChild(imgWrap);
      card.appendChild(info);
      return card;
    }
  },

};

// ── Shared DOM helpers ────────────────────────────────────────────────────────

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(tag, className, content) {
  const node = el(tag, className);
  node.textContent = content ?? '';
  return node;
}

function makeImg(src, alt, className) {
  const img = el('img', className);
  img.src     = src;
  img.alt     = alt;
  img.loading = 'lazy';
  return img;
}

function monogram(name) {
  const node = el('div', 'person-monogram');
  node.textContent = (name ?? '?')
    .split(' ')
    .map(w => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return node;
}

function playLink(item, className) {
  const a = el('a', className);
  a.href = item.links.play;
  a.setAttribute('aria-label', `Play ${item.title}`);
  a.innerHTML = '<i class="fa-solid fa-play"></i><span>Play</span>';
  a.addEventListener('click', e => e.stopPropagation());
  return a;
}

function buildLinks(links, defs, className) {
  if (!links) return null;
  const populated = defs.filter(d => links[d.key]);
  if (!populated.length) return null;

  const wrap = el('div', className);
  populated.forEach(({ key, icon, label }) => {
    const a = el('a');
    a.href   = links[key];
    a.target = '_blank';
    a.rel    = 'noopener';
    a.setAttribute('aria-label', label);
    a.innerHTML = `<i class="${icon}"></i>`;
    a.addEventListener('click', e => e.stopPropagation());
    wrap.appendChild(a);
  });
  return wrap;
}

new CardGrid({ src: 'data/games.json',  target: 'games-grid',  type: 'game' });
