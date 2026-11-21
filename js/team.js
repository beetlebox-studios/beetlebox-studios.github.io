// ── Team network — dev nodes on an evenly spaced ring + decorative web ───────
//
// Dev entries (people.json) are circular nodes placed at equal angles around a
// ring, so spacing stays even for any team size. Behind them, tiny static
// "decor" nodes are scattered with Poisson-disc sampling and wired together
// by k-nearest-neighbour edges, giving a computery web. Each dev node plugs
// into its nearest decor nodes. The web is purely decorative for now —
// later, game nodes and collab edges can be added to the same graph.
//
// Relies on el/text/monogram helpers and GRID_REGISTRY from cards.js.

(function () {
  const container = document.getElementById('people-grid');
  if (!container) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Tuning
  const DECOR_SPACING = 56;   // px — min distance between decor nodes
  const DECOR_K       = 3;    // edges from each decor node to its k nearest
  const DEV_K         = 3;    // edges from each dev node to its k nearest decor nodes
  const DECOR_R       = 2.2;  // px — decor node radius
  const SEED          = 1337; // fixed seed → same web every load
  const DRIFT         = 10;
  const SPRING        = 34;
  const DAMP          = 2 * Math.sqrt(SPRING);
  const FADE_RATE     = 7;
  const RELEASE_MS    = 160;
  const FADE          = 36;
  const GAP           = 10;
  const BOB           = 4;    // px — gentle float shared by people, planets and stickers

  const BEETLE_BADGE = 'https://raw.githubusercontent.com/beetlebox-studios/branding-assets/main/logo/beetle_boot_96.png';

  const LINK_DEFS = [
    { key: 'personal',   icon: 'fa-solid fa-globe',       label: 'Personal site' },
    { key: 'twitter',    icon: 'fa-brands fa-x-twitter',  label: 'Twitter/X' },
    { key: 'github',     icon: 'fa-brands fa-github',     label: 'GitHub' },
    { key: 'itch',       icon: 'fa-brands fa-itch-io',    label: 'itch.io' },
    { key: 'newgrounds', icon: 'fa-brands fa-newgrounds', label: 'Newgrounds' },
    { key: 'youtube',    icon: 'fa-brands fa-youtube',    label: 'YouTube' },
    { key: 'linkedin',   icon: 'fa-brands fa-linkedin',   label: 'LinkedIn' },
  ];

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('team-web');
  svg.setAttribute('aria-hidden', 'true');
  container.appendChild(svg);

  let devs = [];
  let decor = [];
  let decorEdges = [];
  let devLines = [];
  let focus = null;
  let selected = false;
  let launchActive = new Set();
  const launchDevs = {};
  let selectedPerson = null;
  let selectedRole = null;
  let view = { type: 'all' };
  let solarTimer = 0;
  let gamesData = [];
  let bodies = [];
  const aspects = new Map();
  let projectRoles = {};
  let roleOrder = [];
  let size = 72;
  let snap = true;
  let last = 0;
  let release = 0;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const edgeLayer = document.createElementNS(SVG_NS, 'g');
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  svg.append(edgeLayer, nodeLayer);

  function svgEl(tag, cls) {
    const e = document.createElementNS(SVG_NS, tag);
    e.setAttribute('class', cls);
    return e;
  }

  // ── Seeded RNG (mulberry32) ────────────────────────────────────────────────
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ── Poisson-disc (dart throwing) ───────────────────────────────────────────
  function poisson(w, h, minDist, blocked, rand) {
    const pts = [];
    const target = Math.floor((w * h) / (minDist * minDist * 1.6));
    const d2 = minDist * minDist;
    for (let tries = 0; tries < target * 30 && pts.length < target; tries++) {
      const p = { x: rand() * w, y: rand() * h };
      if (blocked(p)) continue;
      if (pts.every(q => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 >= d2)) pts.push(p);
    }
    return pts;
  }

  // Indices of the k nearest points in `pts` to point p (excluding `self`)
  function nearest(p, pts, k, self = -1) {
    return pts
      .map((q, i) => ({ i, d: (q.x - p.x) ** 2 + (q.y - p.y) ** 2 }))
      .filter(o => o.i !== self)
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map(o => o.i);
  }

  // ── Dev node DOM ───────────────────────────────────────────────────────────
  function buildDevNode(item) {
    const node = el('div', 'team-node');

    const circle = el('div', 'team-node-circle');
    if (item.image) {
      circle.appendChild(makeImg(item.image, item.name, 'team-node-photo'));
    } else {
      circle.appendChild(monogram(item.name));
    }
    circle.tabIndex = 0;
    circle.setAttribute('role', 'button');
    circle.setAttribute('aria-label', `Select ${item.name}`);
    circle.addEventListener('click', () => selectPerson(item.name));
    circle.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectPerson(item.name);
    });
    node.appendChild(circle);

    const label = el('div', 'team-node-label');
    const name = text('p', 'team-node-name', '');
    if (item.founder) {
      const badge = makeImg(BEETLE_BADGE, 'Founding member', 'team-badge');
      badge.width = 14;
      badge.height = 14;
      badge.title = 'Founding member';
      badge.loading = 'eager';
      name.appendChild(badge);
    }
    name.appendChild(document.createTextNode(item.name));
    label.appendChild(name);
    label.appendChild(el('div', 'team-node-roles'));

    const links = LINK_DEFS.filter(d => item.links?.[d.key]);
    if (links.length) {
      const row = el('div', 'team-node-links');
      links.forEach(({ key, icon, label: aria }) => {
        const a = el('a');
        a.href   = item.links[key];
        a.target = '_blank';
        a.rel    = 'noopener';
        a.setAttribute('aria-label', aria);
        a.innerHTML = `<i class="${icon}"></i>`;
        row.appendChild(a);
      });
      label.appendChild(row);
    }
    node.appendChild(label);
    return node;
  }

  // Launch buttons (BeetleBox / itch.io / Steam): small circles with a play badge, shown next to the
  // creators of the selected game
  function buildLaunchNode(kind) {
    const node = el('div', `team-node team-node--launch team-node--${kind}`);
    const circle = el('a', 'team-node-circle team-node-launch');
    circle.target = '_blank';
    circle.rel = 'noopener';
    node.appendChild(circle);
    const badge = el('a', 'team-launch-play');
    badge.target = '_blank';
    badge.rel = 'noopener';
    badge.tabIndex = -1;
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = '<i class="fa-solid fa-play"></i>';
    node.appendChild(badge);
    const label = el('div', 'team-node-label');
    label.appendChild(text('p', 'team-node-name', ''));
    label.appendChild(el('div', 'team-node-roles'));
    node.appendChild(label);
    return node;
  }

  function setLaunch(list, title) {
    Object.entries(launchDevs).forEach(([kind, d]) => {
      const info = list.find(l => l.kind === kind);
      if (!info) return;
      const circle = d.node.querySelector('.team-node-launch');
      circle.href = info.url;
      circle.setAttribute('aria-label', `Play ${title} on ${info.label}`);
      circle.replaceChildren();
      if (info.image) circle.appendChild(makeImg(info.image, '', 'team-launch-logo'));
      else circle.innerHTML = `<i class="${info.icon}"></i>`;
      d.node.querySelector('.team-launch-play').href = info.url;
      d.node.querySelector('.team-node-name').textContent = info.label;
      d.roles = [title];
    });
  }

  function sortRoles(roles, who) {
    const known = (roles ?? []).filter(r => {
      if (roleOrder.includes(r)) return true;
      console.warn(`team: unknown role "${r}" for ${who}`);
      return false;
    });
    return [...new Set(known)].sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b));
  }

  function setChips(d, roles) {
    const key = roles.join('|');
    if (d.chips === key) return;
    d.chips = key;
    const row = d.label.querySelector('.team-node-roles');
    row.replaceChildren(...roles.map(r => {
      const chip = text('span', 'pill team-chip', r);
      if (!d.launch) {
        chip.addEventListener('click', e => { e.stopPropagation(); selectRole(r); });
        chip.setAttribute('role', 'button');
      }
      chip.style.setProperty('--shift', Math.round(Math.max(roleOrder.indexOf(r), 0) * 360 / Math.max(roleOrder.length, 1)));
      return chip;
    }));
  }

  // ── Layout + web ───────────────────────────────────────────────────────────
  function buildWeb() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    edgeLayer.replaceChildren();
    nodeLayer.replaceChildren();
    const rand = rng(SEED);
    decor = poisson(w, h, DECOR_SPACING, () => false, rand).map(p => ({
      bx: p.x, by: p.y, x: p.x, y: p.y, a: 1,
      px: rand() * Math.PI * 2, py: rand() * Math.PI * 2,
      fx: 0.00035 + rand() * 0.0004, fy: 0.00035 + rand() * 0.0004,
      el: nodeLayer.appendChild(svgEl('circle', 'team-web-node')),
    }));
    decor.forEach(d => d.el.setAttribute('r', DECOR_R));

    const seen = new Set();
    const maxLen = DECOR_SPACING * 2.5;
    decorEdges = [];
    decor.forEach((p, i) => nearest({ x: p.bx, y: p.by }, decor.map(q => ({ x: q.bx, y: q.by })), DECOR_K, i).forEach(j => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      const len = Math.hypot(p.bx - decor[j].bx, p.by - decor[j].by);
      decorEdges.push({ a: p, b: decor[j], base: Math.max(0.12, 0.5 * (1 - len / maxLen)),
        el: edgeLayer.appendChild(svgEl('line', 'team-web-edge')) });
    }));

    devLines = devs.flatMap(() => Array.from({ length: DEV_K }, () =>
      edgeLayer.appendChild(svgEl('line', 'team-web-edge team-web-edge--dev'))));
  }

  function slots(n, w, h, s, cellW, labelH, k) {
    const cx = w / 2;
    const cy = h / 2 - labelH / 2;
    const rx = Math.max(0, w / 2 - cellW / 2 - 12);
    const ry = Math.max(0, h / 2 - s / 2 - labelH - 12);
    if (n === 1) return [{ x: cx, y: cy }];
    if (n === 2) {
      const d = Math.min(rx, (cellW + GAP * 4) * k);
      return [{ x: cx - d, y: cy }, { x: cx + d, y: cy }];
    }
    return Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k };
    });
  }

  function grid(n, w, h, cols, s, labelH) {
    const rows = Math.ceil(n / cols);
    const cellH = h / rows;
    const offset = (cellH - (s + 6 + labelH)) / 2 + s / 2;
    const pts = [];
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - r * cols);
      for (let c = 0; c < inRow; c++) {
        pts.push({ x: (w / cols) * (c + 0.5 + (cols - inRow) / 2), y: cellH * r + offset });
      }
    }
    return pts;
  }

  function box(p, s, d) {
    const half = Math.max(s, d.w) / 2 + GAP / 2;
    return { l: p.x - half, r: p.x + half, t: p.y - s / 2 - GAP / 2, b: p.y + s / 2 + 6 + d.h + GAP / 2 };
  }

  function fits(pts, s, shown, w, h) {
    const boxes = pts.map((p, i) => box(p, s, shown[i]));
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (a.l < 0 || a.t < 0 || a.r > w || a.b > h) return false;
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) return false;
      }
    }
    return true;
  }

  function updateAnchors() {
    devs.forEach(d => {
      const open = decor.filter(p => {
        const b = box({ x: d.tx, y: d.ty }, d.sz ?? size, d);
        const dx = Math.max(b.l - p.bx, 0, p.bx - b.r);
        const dy = Math.max(b.t - p.by, 0, p.by - b.b);
        return Math.hypot(dx, dy) > FADE * 0.6;
      });
      d.anchors = nearest({ x: d.tx, y: d.ty }, open.map(p => ({ x: p.bx, y: p.by })), DEV_K).map(i => open[i]);
      d.lf = snap ? 1 : 0;
    });
  }

  function resetSolarLook(d) {
    if (d.sz === undefined) return;
    d.sz = undefined;
    d.solarPlaced = false;
    d.node.style.removeProperty('--node-size');
    d.node.classList.remove('team-node--small');
  }

  // ── The universe: every sticker, planet and cover is a permanent object. Each view works out where
  // everything should land (a cramming pass that spreads items apart), and then each object eases to its
  // spot with the same spring the people circles use. Objects that are not in the current view park
  // themselves beyond the panel edge, which clips them. ──────────────────────────────────────────────

  // width / height of an image, so stickers and covers keep their shape; circles are 1
  function preload(src) {
    if (!src || aspects.has(src)) return;
    aspects.set(src, 1);
    const img = new Image();
    img.onload = () => {
      aspects.set(src, img.naturalWidth / img.naturalHeight);
      if (img.naturalWidth <= 128) bodies.filter(b => b.src === src && b.kind === 'sticker').forEach(b => b.node.classList.add('team-game--pixel'));
      arrange();
    };
    img.onerror = () => dropSticker(src);
    img.src = src;
  }

  function buildBody(kind, game, src, i) {
    const node = el(kind === 'cover' ? 'div' : 'a', kind === 'cover' ? 'team-cover' : kind === 'sticker' ? 'team-game team-game--sticker' : 'team-game');
    if (kind === 'sticker') {
      node.appendChild(makeImg(src, game.title, 'team-sticker'));
    } else if (kind === 'cover') {
      node.appendChild(makeImg(src, game.title, 'team-cover-img'));
    } else {
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Open ${game.title}`);
      const ring = el('div', 'team-game-ring');
      if (game.image) ring.appendChild(makeImg(game.image, game.title, 'team-game-img'));
      node.appendChild(ring);
      node.appendChild(text('span', 'team-game-label', game.title));
      node.style.setProperty('--pan', `${9 + (i * 2.3) % 6}s`);
      node.style.setProperty('--fd', `${-(i * 1.3)}s`);
      const pick = () => window.dispatchEvent(new CustomEvent('game:pick', { detail: game.title }));
      node.addEventListener('click', pick);
      node.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        pick();
      });
    }
    node.style.width = '0px';
    node.style.height = '0px';
    container.appendChild(node);
    preload(src);
    return {
      kind, game, src, node, i, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, w: 0, h: 0, active: false,
      p1: i * 1.9 + 0.5, p2: i * 2.7 + 1.3, f1: 0.0017 + (i % 5) * 0.0002, f2: 0.0014 + (i % 7) * 0.00017,
    };
  }

  function dropSticker(src) {
    const gone = bodies.filter(b => b.src === src && b.kind === 'sticker');
    if (!gone.length) return;
    gone.forEach(b => b.node.remove());
    bodies = bodies.filter(b => !gone.includes(b));
    gone.forEach(({ game }) => {
      if (game.image && !bodies.some(b => b.game === game && b.kind !== 'cover')) bodies.push(buildBody('planet', game, game.image, bodies.length));
    });
    arrange();
  }

  function buildBodies() {
    gamesData.filter(g => !g.draft).forEach(game => {
      const stickers = stickersOf(game);
      if (game.image) bodies.push(buildBody('cover', game, game.image, bodies.length));
      if (stickers.length) stickers.forEach(src => bodies.push(buildBody('sticker', game, src, bodies.length)));
      else if (game.image) bodies.push(buildBody('planet', game, game.image, bodies.length));
    });
  }

  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
  const gameHas = (game, name) => (game.credits ?? []).some(c => sameName(c, name));

  // Spread overlapping items apart (and keep them inside the panel), pulling gently back toward where each
  // would like to be. Items carry their centre (x, y) and extents (l, r, t, b) around it.
  function pack(items, w, h) {
    const M = 10;
    const PAD = 6;
    items.forEach(it => { it.ox = it.x; it.oy = it.y; });
    const resolve = () => {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i];
          const B = items[j];
          if (A.fixed && B.fixed) continue;
          const px = Math.min(A.x + A.r + M - (B.x + B.l), B.x + B.r + M - (A.x + A.l));
          const py = Math.min(A.y + A.b + M - (B.y + B.t), B.y + B.b + M - (A.y + A.t));
          if (px <= 0 || py <= 0) continue;
          moved = true;
          const sa = A.fixed ? 0 : B.fixed ? 1 : 0.5;
          const sb = B.fixed ? 0 : A.fixed ? 1 : 0.5;
          if (px < py) {
            const dir = A.x + (A.l + A.r) / 2 <= B.x + (B.l + B.r) / 2 ? -1 : 1;
            A.x += dir * px * sa;
            B.x -= dir * px * sb;
          } else {
            const dir = A.y + (A.t + A.b) / 2 <= B.y + (B.t + B.b) / 2 ? -1 : 1;
            A.y += dir * py * sa;
            B.y -= dir * py * sb;
          }
        }
      }
      items.forEach(it => {
        if (it.fixed) return;
        it.x = Math.min(w - PAD - it.r, Math.max(PAD - it.l, it.x));
        it.y = Math.min(h - PAD - it.b, Math.max(PAD - it.t, it.y));
      });
      return moved;
    };
    for (let iter = 0; iter < 240; iter++) {
      items.forEach(it => {
        if (it.fixed) return;
        it.x += (it.ox - it.x) * 0.015;
        it.y += (it.oy - it.y) * 0.015;
      });
      resolve();
    }
    let clean = !resolve();
    for (let iter = 0; iter < 40 && !clean; iter++) clean = !resolve();
    return clean;
  }

  function devItem(d, x, y) {
    const sz = d.sz ?? size;
    const half = Math.max(sz, d.w || sz) / 2;
    return { ref: d, x, y, l: -half, r: half, t: -sz / 2, b: sz / 2 + 6 + (d.h || 0) };
  }

  function bodyItem(b, x, y, w, h, fixed = false) {
    b.w = w;
    b.h = h;
    return { ref: b, x, y, l: -w / 2, r: w / 2, t: -h / 2, b: h / 2 + (b.kind === 'planet' ? 22 : 0), fixed };
  }

  // the selected game's cover with its stickers in a row under it
  function centerStack(bs, w, h) {
    const cover = bs.find(b => b.kind === 'cover');
    const stickers = bs.filter(b => b.kind === 'sticker');
    const gap = 16;
    let coverW = 0;
    let coverH = 0;
    if (cover) {
      coverW = Math.min(w * 0.5, 260);
      coverH = coverW / (aspects.get(cover.src) || 2.1);
    }
    const n = stickers.length;
    let each = Math.min(w * 0.28, h * 0.17) * (n > 1 ? 0.78 : 1);
    if (n > 1) each = Math.min(each, (w * 0.6 - gap * (n - 1)) / n);
    const sizes = stickers.map(b => {
      const aspect = aspects.get(b.src) || 1;
      const ww = aspect >= 1 ? each : each * aspect;
      return { b, ww, hh: ww / aspect };
    });
    const rowH = sizes.length ? Math.max(...sizes.map(s => s.hh)) : 0;
    const stackH = coverH + (cover && sizes.length ? gap : 0) + rowH;
    const out = [];
    let y = h / 2 - stackH / 2;
    if (cover) {
      out.push(bodyItem(cover, w / 2, y + coverH / 2, coverW, coverH, true));
      y += coverH + gap;
    }
    const rowW = sizes.reduce((sum, s) => sum + s.ww, 0) + gap * Math.max(0, sizes.length - 1);
    let x = w / 2 - rowW / 2;
    sizes.forEach(({ b, ww, hh }) => {
      out.push(bodyItem(b, x + ww / 2, y + rowH / 2, ww, hh));
      x += ww + gap;
    });
    return out;
  }

  // ring layout of the people shown in the all / game / role views
  function planRing(w, h, base, people, bodyList) {
    let shown = people.filter(d => !focus || focus.has(d.item.name.toLowerCase()));
    if (!shown.length) shown = people;
    shown = [...shown, ...Object.entries(launchDevs).filter(([kind]) => launchActive.has(kind)).map(([, d]) => d)];
    devs.forEach(d => {
      resetSolarLook(d);
      const own = focus && projectRoles[d.item.name];
      setChips(d, own ? sortRoles(own, d.item.name) : d.roles);
      d.ta = shown.includes(d) ? 1 : 0;
      d.node.classList.toggle('team-node--focus', !!focus && d.ta === 1 && view.type !== 'role');
    });
    shown.forEach(d => { d.w = d.label.offsetWidth; d.h = d.label.offsetHeight - d.links; });
    const cellW = Math.max(...shown.map(d => d.w));
    const labelH = Math.max(...shown.map(d => d.h));
    const sizes = [];
    for (let s = base; s >= 44; s -= 4) sizes.push(s);
    let best = null;
    for (const s of sizes) {
      for (let k = bodyList.length ? 1 : Math.min(1, 0.35 + 0.1 * shown.length); k <= 1.001 && !best; k += 0.05) {
        const pts = slots(shown.length, w, h, s, Math.max(s, cellW), labelH, k);
        if (fits(pts, s, shown, w, h)) best = { s, pts };
      }
      if (best) break;
    }
    for (const s of [...sizes, 40, 36]) {
      for (let cols = 2; cols < shown.length && !best; cols++) {
        const pts = grid(shown.length, w, h, cols, s, labelH);
        if (fits(pts, s, shown, w, h)) best = { s, pts };
      }
      if (best) break;
    }
    if (!best) {
      const cols = Math.max(1, Math.min(shown.length, Math.floor(w / Math.max(36, cellW))));
      best = { s: 36, pts: grid(shown.length, w, h, cols, 36, labelH) };
    }
    size = best.s;
    container.style.setProperty('--node-size', `${size}px`);
    return shown.map((d, i) => devItem(d, best.pts[i].x, best.pts[i].y));
  }

  // a selected creator in the middle, their games on a ring around them and the people they worked with
  // further out, each shown once at the average angle of the games they share
  function planPerson(w, h, base, people, bodyList, scale = 1) {
    const cx = w / 2;
    const cy = h / 2;
    const small = Math.max(28, Math.round(base * 0.52 * Math.min(1, scale + 0.2)));
    size = base;
    container.style.setProperty('--node-size', `${base}px`);
    const name = view.name;
    devs.forEach(d => { d.ta = 0; d.node.classList.remove('team-node--focus'); });
    const items = [];
    const center = people.find(d => sameName(d.item.name, name));
    if (center) {
      resetSolarLook(center);
      center.ta = 1;
      center.w = center.label.offsetWidth;
      center.h = center.label.offsetHeight - center.links;
      items.push(devItem(center, cx, cy));
    }
    const n = bodyList.length;
    const rx1 = (w / 2) * 0.55;
    const ry1 = (h / 2) * 0.44;
    const angles = bodyList.map((_, i) => -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2);
    const pts = angles.map(a => ({ x: cx + Math.cos(a) * rx1, y: cy + Math.sin(a) * ry1 }));
    let gap = w * 0.25;
    if (n > 1) gap = Math.min(...pts.map((p, i) => Math.hypot(p.x - pts[(i + 1) % n].x, p.y - pts[(i + 1) % n].y)));
    const gD = Math.max(34, Math.min(w * 0.17, gap * 0.8) * scale);
    bodyList.forEach((b, i) => {
      const aspect = b.kind === 'sticker' ? aspects.get(b.src) || 1 : 1;
      const ww = aspect >= 1 ? gD : gD * aspect;
      items.push(bodyItem(b, pts[i].x, pts[i].y, ww, ww / aspect));
    });

    const collab = people.filter(d => d !== center && bodyList.some(b => gameHas(b.game, d.item.name)));
    const rx2 = w / 2 - small / 2 - 12;
    const ry2 = Math.min(h / 2 - small / 2 - 26, ry1 * (rx2 / rx1));
    const placed = collab.map(d => {
      const mine = bodyList.map((b, i) => (gameHas(b.game, d.item.name) ? i : -1)).filter(i => i >= 0);
      const sx = mine.reduce((sum, i) => sum + Math.cos(angles[i]), 0);
      const sy = mine.reduce((sum, i) => sum + Math.sin(angles[i]), 0);
      return { d, t: Math.atan2(sy, sx) };
    }).sort((a, b) => a.t - b.t);
    const minSep = Math.min(Math.PI, (small + 34) / ((rx2 + ry2) / 2));
    for (let pass = 0; pass < 80 && placed.length > 1; pass++) {
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i];
        const b = placed[(i + 1) % placed.length];
        let gapA = b.t - a.t;
        if (i === placed.length - 1) gapA += Math.PI * 2;
        if (gapA < minSep) {
          const push = (minSep - gapA) / 2;
          a.t -= push;
          b.t += push;
        }
      }
    }
    placed.forEach(({ d, t }) => {
      d.sz = small;
      d.node.style.setProperty('--node-size', `${small}px`);
      d.node.classList.add('team-node--small');
      d.ta = view.shown ? 1 : 0;
      d.w = d.label.offsetWidth;
      d.h = d.label.offsetHeight - d.links;
      items.push(devItem(d, cx + Math.cos(t) * rx2, cy + Math.sin(t) * ry2));
    });
    return items;
  }

  function parked(b, w, h) {
    const a = b.i * 2.399;
    const r = Math.max(w, h) * 0.75 + 120;
    return { x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r };
  }

  function arrange() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || !devs.length) return;
    const people = devs.filter(d => !d.launch);
    const base = Math.max(44, Math.min(84, Math.min(w, h) * 0.15));

    // which permanent objects take part in this view
    let active = [];
    if (view.type === 'game') active = bodies.filter(b => b.game.title === view.title && (b.kind === 'cover' || b.kind === 'sticker'));
    else if (view.type === 'role') active = bodies.filter(b => b.kind === 'sticker');
    else if (view.type === 'person') {
      active = bodies.filter(b => b.kind !== 'cover' && gameHas(b.game, view.name));
    }

    let items;
    if (view.type === 'person') {
      // shrink the planets until the cramming pass can fit everything without overlaps
      for (const scale of [1, 0.85, 0.72, 0.6]) {
        items = planPerson(w, h, base, people, active, scale);
        if (pack(items, w, h)) break;
      }
    } else {
      items = planRing(w, h, base, people, active);
      if (view.type === 'game') items.push(...centerStack(active, w, h));
      else if (view.type === 'role') {
        // the stickers stay: a row of them in the middle of the people
        const each = Math.min(w * 0.18, h * 0.12);
        const total = active.length * each + Math.max(0, active.length - 1) * 14;
        active.forEach((b, i) => {
          const aspect = aspects.get(b.src) || 1;
          const ww = aspect >= 1 ? each : each * aspect;
          items.push(bodyItem(b, w / 2 - total / 2 + each / 2 + i * (each + 14), h / 2, ww, ww / aspect));
        });
      }
    }

    if (view.type !== 'person') pack(items, w, h);

    bodies.forEach(b => {
      const it = items.find(x => x.ref === b);
      b.active = !!it;
      if (it) {
        b.tx = it.x;
        b.ty = it.y;
        b.node.style.width = `${b.w}px`;
        b.node.style.height = `${b.h}px`;
      } else {
        const p = parked(b, w, h);
        b.tx = p.x;
        b.ty = p.y;
      }
      if (!b.placed) { b.placed = true; const p = parked(b, w, h); b.x = p.x; b.y = p.y; }
    });
    devs.forEach(d => {
      const it = items.find(x => x.ref === d);
      if (it) { d.tx = it.x; d.ty = it.y; }
      if (d.tx === undefined) { d.tx = w / 2; d.ty = h / 2; }
      if (snap) { d.x = d.tx; d.y = d.ty; d.a = d.ta; d.vx = 0; d.vy = 0; }
      // collaborators appear where they will sit
      if (d.sz !== undefined && !d.solarPlaced) { d.solarPlaced = true; d.x = d.tx; d.y = d.ty; d.vx = 0; d.vy = 0; }
    });
    updateAnchors();
    snap = false;
  }

  function stepBodies(t, dt) {
    const amp = reduceMotion.matches ? 0 : BOB;
    bodies.forEach(b => {
      b.vx += (SPRING * (b.tx - b.x) - DAMP * b.vx) * dt;
      b.vy += (SPRING * (b.ty - b.y) - DAMP * b.vy) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.node.style.left = `${b.x - b.w / 2}px`;
      b.node.style.top = `${b.y - b.h / 2}px`;
      b.node.style.translate = b.active ? `${(Math.sin(t * b.f1 + b.p1) * amp).toFixed(2)}px ${(Math.cos(t * b.f2 + b.p2) * amp).toFixed(2)}px` : '';
    });
  }

  function nearDev(p) {
    let a = 1;
    devs.forEach(d => {
      if (d.a < 0.01) return;
      const b = box(d, d.sz ?? size, d);
      const dx = Math.max(b.l - p.x, 0, p.x - b.r);
      const dy = Math.max(b.t - p.y, 0, p.y - b.b);
      const fade = Math.min(1, Math.hypot(dx, dy) / FADE);
      a = Math.min(a, 1 - d.a * (1 - fade));
    });
    return a;
  }

  function tick(t) {
    const dt = Math.min(1 / 30, last ? (t - last) / 1000 : 0);
    last = t;
    const drift = reduceMotion.matches ? 0 : DRIFT;
    const fade = 1 - Math.exp(-FADE_RATE * dt);
    stepBodies(t, dt);
    devs.forEach(d => {
      d.vx = (d.vx || 0) + (SPRING * (d.tx - d.x) - DAMP * (d.vx || 0)) * dt;
      d.vy = (d.vy || 0) + (SPRING * (d.ty - d.y) - DAMP * (d.vy || 0)) * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += (d.ta - d.a) * fade;
      d.lf = (d.lf ?? 1) + (1 - (d.lf ?? 1)) * fade;
      const sz = d.sz ?? size;
      d.node.style.left = `${d.x - sz / 2}px`;
      d.node.style.top = `${d.y - sz / 2}px`;
      d.node.style.translate = reduceMotion.matches ? '' : `${(Math.sin(t * d.f1 + d.p1) * BOB).toFixed(2)}px ${(Math.cos(t * d.f2 + d.p2) * BOB).toFixed(2)}px`;
      const settled = d.a > 0.995;
      d.node.style.opacity = settled ? '' : d.a.toFixed(3);
      d.node.style.scale = settled ? '' : (0.7 + 0.3 * d.a).toFixed(3);
      d.node.classList.toggle('team-node--out', d.ta === 0);
    });

    decor.forEach(p => {
      p.x = p.bx + Math.sin(t * p.fx + p.px) * drift;
      p.y = p.by + Math.cos(t * p.fy + p.py) * drift;
      p.a = nearDev(p);
      p.el.setAttribute('cx', p.x.toFixed(1));
      p.el.setAttribute('cy', p.y.toFixed(1));
      p.el.style.opacity = (0.7 * p.a).toFixed(3);
    });

    decorEdges.forEach(e => {
      e.el.setAttribute('x1', e.a.x.toFixed(1));
      e.el.setAttribute('y1', e.a.y.toFixed(1));
      e.el.setAttribute('x2', e.b.x.toFixed(1));
      e.el.setAttribute('y2', e.b.y.toFixed(1));
      e.el.style.opacity = (e.base * Math.min(e.a.a, e.b.a)).toFixed(3);
    });

    devs.forEach((d, i) => {
      const glow = d.node.classList.contains('team-node--focus') ? 0.95 : 0.55;
      for (let k = 0; k < DEV_K; k++) {
        const line = devLines[i * DEV_K + k];
        const q = d.anchors?.[k];
        if (!line) continue;
        if (!q || d.a < 0.01) { line.style.opacity = 0; continue; }
        line.setAttribute('x1', d.x.toFixed(1));
        line.setAttribute('y1', d.y.toFixed(1));
        line.setAttribute('x2', q.x.toFixed(1));
        line.setAttribute('y2', q.y.toFixed(1));
        line.style.opacity = (glow * d.a * d.lf * q.a).toFixed(3);
      }
    });

    requestAnimationFrame(tick);
  }

  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!devs.length) return;
      buildWeb();
      snap = true;
      arrange();
    });
  }).observe(container);

  window.addEventListener('team:select', e => {
    clearTimeout(release);
    clearTimeout(solarTimer);
    const pick = e.detail;
    selected = !!pick;
    selectedPerson = null;
    selectedRole = null;
    view = pick ? { type: 'game', title: pick.title } : { type: 'all' };
    focus = pick?.credits?.length ? new Set(pick.credits.map(n => n.toLowerCase())) : null;
    projectRoles = pick?.roles ?? {};
    launchActive = new Set((pick?.launch ?? []).map(l => l.kind));
    if (pick?.launch?.length) setLaunch(pick.launch, pick.title);
    markSelectedPerson();
    arrange();
    markRoleChips();
  });

  function markSelectedPerson() {
    devs.forEach(d => d.node.classList.toggle('team-node--selected', !d.launch && d.item.name === selectedPerson));
  }

  function markRoleChips() {
    devs.forEach(d => d.label.querySelectorAll('.team-chip').forEach(c => c.classList.toggle('team-chip--selected', !!selectedRole && c.textContent === selectedRole)));
  }

  // Clicking a creator selects them: they move to the middle with their games around them
  function selectPerson(name) {
    clearTimeout(release);
    clearTimeout(solarTimer);
    selectedPerson = selectedPerson === name ? null : name;
    selected = false;
    selectedRole = null;
    focus = null;
    projectRoles = {};
    launchActive = new Set();
    if (selectedPerson) {
      view = { type: 'person', name: selectedPerson, shown: false };
      // everyone else hides first, then the collaborators come back smaller around the games
      solarTimer = setTimeout(() => { if (view.type === 'person') { view.shown = true; arrange(); } }, 520);
    } else {
      view = { type: 'all' };
    }
    markSelectedPerson();
    arrange();
    markRoleChips();
    window.dispatchEvent(new CustomEvent('person:select', { detail: selectedPerson }));
  }

  // Clicking a role chip filters the explorer to the people with that role; the stickers stay
  function selectRole(role) {
    clearTimeout(release);
    clearTimeout(solarTimer);
    selectedRole = selectedRole === role ? null : role;
    selectedPerson = null;
    selected = false;
    projectRoles = {};
    launchActive = new Set();
    if (selectedRole) {
      view = { type: 'role', role: selectedRole };
      focus = new Set(devs.filter(d => !d.launch && d.roles.includes(selectedRole)).map(d => d.item.name.toLowerCase()));
    } else {
      view = { type: 'all' };
      focus = null;
    }
    markSelectedPerson();
    arrange();
    markRoleChips();
    window.dispatchEvent(new CustomEvent('role:select', { detail: selectedRole }));
  }

  window.addEventListener('team:focus', e => {
    if (selected || selectedPerson || selectedRole) return;
    clearTimeout(release);
    const credits = e.detail?.credits;
    const next = credits?.length ? new Set(credits.map(n => n.toLowerCase())) : null;
    if (next) { focus = next; projectRoles = e.detail.roles ?? {}; arrange(); return; }
    release = setTimeout(() => { focus = null; projectRoles = {}; arrange(); }, RELEASE_MS);
  });

  window.addEventListener('person:clear', () => { if (selectedPerson) selectPerson(selectedPerson); });
  window.addEventListener('role:clear', () => { if (selectedRole) selectRole(selectedRole); });

  container.addEventListener('click', e => {
    if (e.target.closest('.team-node, .team-game')) return;
    if (selectedPerson) selectPerson(selectedPerson);
    else if (selectedRole) selectRole(selectedRole);
  });

  // ── Load people ────────────────────────────────────────────────────────────
  (async () => {
    let items;
    try {
      const [people, roles, games] = await Promise.all(['data/people.json', 'data/roles.json', 'data/games.json'].map(f => fetch(f).then(r => r.json())));
      items = people;
      gamesData = games;
      roleOrder = roles;
    } catch (e) {
      console.warn('team: failed to load people.json or roles.json', e);
      return;
    }

    devs = items.map((item, i) => {
      const node = buildDevNode(item);
      node.style.setProperty('--delay', `${i * 60}ms`);
      container.appendChild(node);
      const links = node.querySelector('.team-node-links');
      const d = { item, node, label: node.querySelector('.team-node-label'), roles: sortRoles(item.roles, item.name),
        links: links ? links.offsetHeight + parseFloat(getComputedStyle(links).marginTop) : 0, x: 0, y: 0, a: 0, ta: 1,
        p1: i * 2.3 + 0.7, p2: i * 1.7 + 2.1, f1: 0.0016 + (i % 5) * 0.0002, f2: 0.0013 + (i % 7) * 0.00017 };
      setChips(d, d.roles);
      return d;
    });
    ['bbox', 'itch', 'steam'].forEach((kind, k) => {
      const node = buildLaunchNode(kind);
      node.style.setProperty('--delay', '0ms');
      container.appendChild(node);
      const d = { item: { name: `__launch-${kind}__`, roles: [], links: {} }, launch: true, node,
        label: node.querySelector('.team-node-label'), roles: [], links: 0, x: 0, y: 0, a: 0, ta: 0,
        p1: k * 2.9, p2: k * 1.3 + 1, f1: 0.0018, f2: 0.0015 };
      launchDevs[kind] = d;
      devs.push(d);
    });
    buildBodies();
    buildWeb();
    arrange();
    requestAnimationFrame(tick);
  })();
})();
