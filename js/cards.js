// ── CardGrid — generalized data-driven card renderer ─────────────────────────
//
// Usage:
//   new CardGrid({ src, target, type })
//
// JSON shape — game:
//   { title, meta, order, repo, stack, status, description, image, screenshot, draft, gif (one url or a list to shuffle), jam: { label, logo }, credits: ["Name", …], roles: { Name: ["Role", …] },
//     links: { play, itch, steam, trailer, github } }

// ── Shared state ─────────────────────────────────────────────────────────────

// Maps grid-id → array of { item, cardEl } after each grid loads.
const GRID_REGISTRY = {};

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

    const visible = items.filter(isVisible);
    // pinLast games (Octane) always close the grid, after the main and jam groups
    const groups = [visible.filter(item => !item.jam && !item.pinLast), visible.filter(item => item.jam), visible.filter(item => item.pinLast)]
      .map(group => group.sort(byOrder))
      .filter(group => group.length);
    let i = 0;
    groups.forEach(group => {
      group.forEach(item => {
        const card = def.buildCard(item, i++);
        if (item.draft) card.classList.add('is-draft');
        GRID_REGISTRY[this.target].push({ item, card });
        grid.appendChild(card);
      });
    });
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

let selected = null;
let selectedPersonName = null;
let selectedRoleName = null;

const BEETLE_ICON = 'https://raw.githubusercontent.com/beetlebox-studios/branding-assets/main/logo/beetle_boot_96.png';

// One launch button per place the game can be played: BeetleBox (the web build), itch.io and Steam
const GIF_UNLOAD_AFTER = 45000;
const HOVER_SELECT_AFTER = 900;
const PLAY_PREFERENCE = ['steam', 'itch', 'bbox'];

function gifsOf(item) {
  return [item.gif ?? []].flat().filter(Boolean);
}

function shuffled(list, avoidFirst) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out[0] === avoidFirst) out.push(out.shift());
  return out;
}

function makeGifPreview(sources) {
  const el = document.createElement('img');
  el.className = 'work-gif';
  el.alt = '';
  el.setAttribute('aria-hidden', 'true');
  el.addEventListener('load', () => { if (el.getAttribute('src')) el.classList.add('is-loaded'); });
  let order = shuffled(sources);
  let index = 0;
  let unloadTimer = null;
  let visible = false;
  let played = false;

  const load = src => {
    el.classList.remove('is-loaded');
    el.src = src;
  };
  const unloadLater = () => {
    clearTimeout(unloadTimer);
    unloadTimer = setTimeout(() => {
      el.classList.remove('is-loaded');
      el.removeAttribute('src');
    }, GIF_UNLOAD_AFTER);
  };

  return {
    el,
    warm() {
      clearTimeout(unloadTimer);
      if (visible) return;
      if (played && sources.length > 1) {
        played = false;
        index++;
        if (index >= order.length) { order = shuffled(sources, order[order.length - 1]); index = 0; }
        load(order[index]);
      } else if (!el.getAttribute('src')) {
        load(order[index]);
      }
    },
    cool() {
      if (!visible) unloadLater();
    },
    show() {
      if (visible) return;
      this.warm();
      visible = true;
      played = true;
      el.classList.add('is-shown');
    },
    hide() {
      if (!visible) return;
      visible = false;
      el.classList.remove('is-shown');
      unloadLater();
    },
  };
}

// only the selected game's gif plays; hovering a card loads it early so selecting shows it at once
function syncGif(card) {
  const gif = card._gif;
  if (!gif) return;
  if (card.classList.contains('is-selected')) gif.show();
  else gif.hide();
}

function launchOf(item) {
  const links = item.links ?? {};
  const list = [];
  if (links.play)  list.push({ kind: 'bbox',  url: links.play,  label: 'BeetleBox', image: BEETLE_ICON });
  if (links.itch)  list.push({ kind: 'itch',  url: links.itch,  label: 'itch.io',   icon: 'fa-brands fa-itch-io' });
  if (links.steam) list.push({ kind: 'steam', url: links.steam, label: 'Steam',     icon: 'fa-brands fa-steam' });
  return list;
}

function playButton(item) {
  const launch = launchOf(item);
  const pick = PLAY_PREFERENCE.map(kind => launch.find(l => l.kind === kind)).find(Boolean);
  if (!pick) return null;
  const a = el('a', 'work-play-go');
  a.href = pick.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', `Play ${item.title} on ${pick.label}`);
  a.title = pick.label;
  a.innerHTML = '<i class="fa-solid fa-play"></i>';
  a.addEventListener('click', e => e.stopPropagation());
  return a;
}

function setSelected(card, item) {
  if (selected) {
    selected.card.classList.remove('is-selected');
    selected.card.setAttribute('aria-pressed', 'false');
    selected.card._confirmed = false;
    syncGif(selected.card);
  }
  selected = card ? { card, item } : null;
  showRelated(null);
  if (card) {
    card._confirmed = false;
    card.classList.add('is-selected');
    card.setAttribute('aria-pressed', 'true');
    syncGif(card);
  }
  window.dispatchEvent(new CustomEvent('team:select', {
    detail: card ? { title: item.title, credits: item.credits ?? [], roles: item.roles ?? {}, launch: launchOf(item), cover: item.image || '' } : null,
  }));
}

// Outline the games a selected creator worked on and dim the rest
function showRelated(name) {
  selectedPersonName = name;
  selectedRoleName = null;
  (GRID_REGISTRY['games-grid'] ?? []).forEach(({ item, card }) => {
    const related = !!name && (item.credits ?? []).some(c => c.toLowerCase() === name.toLowerCase());
    card.classList.toggle('is-related', related);
    card.classList.toggle('is-dim', !!name && !related);
  });
}

// a game circle in the creator view was clicked: select that game
window.addEventListener('game:pick', e => {
  const entry = (GRID_REGISTRY['games-grid'] ?? []).find(({ item }) => item.title === e.detail);
  if (entry && selected?.card !== entry.card) setSelected(entry.card, entry.item);
});

// Outline the games where someone worked in the selected role
function showRelatedRole(role) {
  selectedRoleName = role;
  (GRID_REGISTRY['games-grid'] ?? []).forEach(({ item, card }) => {
    const related = !!role && Object.values(item.roles ?? {}).some(list => list.includes(role));
    card.classList.toggle('is-related', related);
    card.classList.toggle('is-dim', !!role && !related);
  });
}

window.addEventListener('role:select', e => {
  const role = e.detail;
  if (role && selected) {
    selected.card.classList.remove('is-selected');
    selected.card.setAttribute('aria-pressed', 'false');
    syncGif(selected.card);
    selected = null;
  }
  selectedPersonName = null;
  showRelatedRole(role);
});

window.addEventListener('person:select', e => {
  const name = e.detail;
  if (name && selected) {
    selected.card.classList.remove('is-selected');
    selected.card.setAttribute('aria-pressed', 'false');
    syncGif(selected.card);
    selected = null;
  }
  showRelated(name);
});

function toggleSelected(card, item) {
  setSelected(selected?.card === card ? null : card, item);
}

document.addEventListener('click', e => {
  if (e.target.closest('.work-card, #people-grid')) return;
  if (selected) setSelected(null);
  if (selectedPersonName) window.dispatchEvent(new CustomEvent('person:clear'));
  if (selectedRoleName) window.dispatchEvent(new CustomEvent('role:clear'));
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (selected) setSelected(null);
  if (selectedPersonName) window.dispatchEvent(new CustomEvent('person:clear'));
  if (selectedRoleName) window.dispatchEvent(new CustomEvent('role:clear'));
});

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
        imgWrap.appendChild(makeImg(item.image, item.title, item.draft ? 'work-img work-img--draft' : 'work-img'));
      }
      if (item.screenshot) {
        imgWrap.appendChild(makeImg(item.screenshot, item.title, 'work-img work-shot'));
      }
      imgWrap.appendChild(el('div', 'work-placeholder-bg'));

      const gifs = gifsOf(item);
      if (gifs.length && !item.draft) {
        const gif = makeGifPreview(gifs);
        card.addEventListener('mouseenter', () => gif.warm());
        card.addEventListener('mouseleave', () => gif.cool());
        card._gif = gif;
        imgWrap.appendChild(gif.el);
      }

      const play = playButton(item);

      let dwell = 0;
      card.addEventListener('mouseenter', () => {
        window.dispatchEvent(new CustomEvent('team:focus', { detail: item.credits ? { credits: item.credits, roles: item.roles ?? {} } : null }));
        clearTimeout(dwell);
        if (selected?.card === card) return;
        dwell = setTimeout(() => {
          if (selected?.card !== card) setSelected(card, item);
        }, HOVER_SELECT_AFTER);
      });
      card.addEventListener('mouseleave', () => {
        clearTimeout(dwell);
        window.dispatchEvent(new CustomEvent('team:focus', { detail: null }));
      });

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
        const draft = text('span', 'pill work-status work-draft-badge', 'Draft');
        draft.dataset.status = 'draft';
        imgWrap.appendChild(draft);
      }

      // ── Info
      const info = el('div', 'work-info');
      const titleRow = el('div', 'work-title-row');
      titleRow.appendChild(text('p', 'work-title', item.title));
      if (item.status) {
        const status = text('span', 'pill work-status', item.status);
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
      if (play) {
        info.classList.add('has-play');
        info.appendChild(play);
      }
      // A click selects a game or confirms a hover selection; clicking a confirmed selection plays it
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', 'false');
      const activate = () => {
        clearTimeout(dwell);
        if (play && selected?.card === card) {
          if (card._confirmed) play.click();
          card._confirmed = true;
          return;
        }
        toggleSelected(card, item);
        card._confirmed = selected?.card === card;
      };
      card.addEventListener('click', activate);
      card.addEventListener('keydown', e => {
        if (e.target !== card || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        activate();
      });

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
  a.target = '_blank';
  a.rel = 'noopener';
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
