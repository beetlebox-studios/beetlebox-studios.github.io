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
  let solar = null;
  let solarTimer = 0;
  let gamesData = [];
  let gameNodes = [];
  let centerNodes = [];
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

  function arrange() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || !devs.length) return;
    if (solar) { arrangeSolar(w, h); return; }
    devs.forEach(d => resetSolarLook(d));

    const people = devs.filter(d => !d.launch);
    let shown = people.filter(d => !focus || focus.has(d.item.name.toLowerCase()));
    if (!shown.length) shown = people;
    shown = [...shown, ...Object.entries(launchDevs).filter(([kind]) => launchActive.has(kind)).map(([, d]) => d)];
    devs.forEach(d => {
      const own = focus && projectRoles[d.item.name];
      setChips(d, own ? sortRoles(own, d.item.name) : d.roles);
      d.ta = shown.includes(d) ? 1 : 0;
      d.node.classList.toggle('team-node--focus', !!focus && d.ta === 1);
    });

    const base = Math.max(44, Math.min(84, Math.min(w, h) * 0.15));
    shown.forEach(d => { d.w = d.label.offsetWidth; d.h = d.label.offsetHeight - d.links; });
    const cellW = Math.max(...shown.map(d => d.w));
    const labelH = Math.max(...shown.map(d => d.h));
    const sizes = [];
    for (let s = base; s >= 44; s -= 4) sizes.push(s);
    let best = null;
    for (const s of sizes) {
      for (let k = centerNodes.length ? 1 : Math.min(1, 0.35 + 0.1 * shown.length); k <= 1.001 && !best; k += 0.05) {
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
    shown.forEach((d, i) => { d.tx = best.pts[i].x; d.ty = best.pts[i].y; });
    devs.forEach(d => {
      if (d.tx === undefined) { d.tx = w / 2; d.ty = h / 2; }
      if (snap) { d.x = d.tx; d.y = d.ty; d.a = d.ta; d.vx = 0; d.vy = 0; }
    });
    updateAnchors();
    layoutCenter(w, h);
    snap = false;
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
    stepField(t, dt);
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
    const pick = e.detail;
    selected = !!pick;
    selectedPerson = null;
    leaveSolar();
    if (pick && (pick.cover || pick.stickers?.length)) showCenter(pick);
    else clearCenter();
    focus = pick?.credits?.length ? new Set(pick.credits.map(n => n.toLowerCase())) : null;
    projectRoles = pick?.roles ?? {};
    launchActive = new Set((pick?.launch ?? []).map(l => l.kind));
    if (pick?.launch?.length) setLaunch(pick.launch, pick.title);
    markSelectedPerson();
    arrange();
  });

  function markSelectedPerson() {
    devs.forEach(d => d.node.classList.toggle('team-node--selected', !d.launch && d.item.name === selectedPerson));
  }

  // ── Solar system: a selected creator sits in the middle, their games orbit them as circle-cropped
  // images, and the people they worked with float further out, each shown once ────────────────────
  function resetSolarLook(d) {
    if (d.sz === undefined) return;
    d.sz = undefined;
    d.solarPlaced = false;
    d.node.style.removeProperty('--node-size');
    d.node.classList.remove('team-node--small');
  }

  function stickersOf(game) {
    return game.favicons ?? [];
  }

  // width / height of a sticker image, so it keeps its shape; circles are 1
  function preload(src) {
    if (aspects.has(src)) return;
    aspects.set(src, 1);
    const img = new Image();
    img.onload = () => {
      aspects.set(src, img.naturalWidth / img.naturalHeight);
      if (solar || centerNodes.length) arrange();
    };
    img.src = src;
  }

  // A planet is either a circle-cropped thumbnail, or (when the game has favicons) one outlined sticker
  // per favicon: no circle and no label
  function buildPlanet(planet, i) {
    const { game, sticker } = planet;
    const node = el('a', sticker ? 'team-game team-game--sticker' : 'team-game');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `Open ${game.title}`);
    node.style.setProperty('--float', `${6 + (i * 1.7) % 4}s`);
    node.style.setProperty('--pan', `${9 + (i * 2.3) % 6}s`);
    node.style.setProperty('--fd', `${-(i * 1.3)}s`);
    if (sticker) {
      preload(sticker);
      node.dataset.src = sticker;
      node.appendChild(makeImg(sticker, game.title, 'team-sticker'));
    } else {
      const ring = el('div', 'team-game-ring');
      if (game.image) ring.appendChild(makeImg(game.image, game.title, 'team-game-img'));
      node.appendChild(ring);
      node.appendChild(text('span', 'team-game-label', game.title));
    }
    const pick = () => window.dispatchEvent(new CustomEvent('game:pick', { detail: game.title }));
    node.addEventListener('click', pick);
    node.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      pick();
    });
    container.appendChild(node);
    return node;
  }

  // Planets are never faded: the panel is a clip layer, so they slide past its edge and get cut off by it
  function offscreen(x, y) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dx = x - w / 2 || 1;
    const dy = y - h / 2 || 1;
    const k = Math.max(w, h) / Math.hypot(dx, dy);
    return { x: w / 2 + dx * k * 1.2, y: h / 2 + dy * k * 1.2 };
  }

  // ── Planets and stickers are free-floating bodies: they spring toward their slot, bob gently, and a
  // force field keeps them (and the people nodes) from overlapping ───────────────────────────────────
  const GAP_FIELD = 14;
  const FIELD_PUSH = 60;
  const BODY_SPRING = 16;
  const BODY_DAMP = 2 * Math.sqrt(BODY_SPRING);
  const BOB = 7;
  const field = new Set();

  // centre the node on (x, y); the first time, start beyond the panel edge and drift in
  function placeNode(node, x, y, w, h, fixed = false) {
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    let b = node._body;
    if (!b) {
      const out = offscreen(x, y);
      const seed = field.size * 1.7 + 1;
      b = node._body = {
        x: out.x, y: out.y, vx: 0, vy: 0, w, h, fixed, out: false,
        p1: seed, p2: seed * 2.1, f1: 0.0016 + (seed % 5) * 0.0002, f2: 0.0013 + (seed % 7) * 0.00017,
      };
      field.add(node);
    }
    b.tx = x;
    b.ty = y;
    b.w = w;
    b.h = h;
    b.fixed = fixed;
  }

  function slideOut(nodes) {
    nodes.forEach(n => {
      const b = n._body;
      if (!b) { n.remove(); return; }
      const out = offscreen(b.x, b.y);
      b.tx = out.x;
      b.ty = out.y;
      b.out = true;
      setTimeout(() => { field.delete(n); n.remove(); }, 1100);
    });
  }

  function stepField(t, dt) {
    const bodies = [...field].map(n => ({ n, b: n._body }));
    const live = bodies.filter(({ b }) => !b.out);
    bodies.forEach(({ b }) => {
      b.ax = BODY_SPRING * (b.tx - b.x) - BODY_DAMP * b.vx;
      b.ay = BODY_SPRING * (b.ty - b.y) - BODY_DAMP * b.vy;
    });
    // box-vs-box repulsion with a margin, so bodies keep their distance before they touch
    const push = (a, hxA, hyA, o, hxO, hyO, moveO, moveA) => {
      const dx = o.x - a.x;
      const dy = o.y - a.y;
      const px = hxA + hxO + GAP_FIELD - Math.abs(dx);
      const py = hyA + hyO + GAP_FIELD - Math.abs(dy);
      if (px <= 0 || py <= 0) return;
      if (px < py) {
        const f = px * FIELD_PUSH * Math.sign(dx || 1);
        if (moveO) o.ax += f;
        if (moveA) a.ax -= f;
      } else {
        const f = py * FIELD_PUSH * Math.sign(dy || 1);
        if (moveO) o.ay += f;
        if (moveA) a.ay -= f;
      }
    };
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i].b;
        const B = live[j].b;
        if (A.fixed && B.fixed) continue;
        push(A, A.w / 2, A.h / 2, B, B.w / 2, B.h / 2, !B.fixed, !A.fixed);
      }
      const A = live[i].b;
      if (A.fixed) continue;
      devs.forEach(d => {
        if (d.a < 0.3) return;
        const r = (d.sz ?? size) / 2 + 6;
        push({ x: d.x, y: d.y }, r, r + 12, A, A.w / 2, A.h / 2, true, false);
      });
    }
    bodies.forEach(({ n, b }) => {
      b.vx += b.ax * dt;
      b.vy += b.ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // once a body has slid in, the panel edge becomes a wall; leaving bodies pass through it
      const W = container.clientWidth;
      const H = container.clientHeight;
      if (!b.out) {
        if (b.born === undefined) b.born = t;
        if (t - b.born > 1000) {
          b.x = Math.min(W - b.w / 2 - 6, Math.max(b.w / 2 + 6, b.x));
          b.y = Math.min(H - b.h / 2 - 6, Math.max(b.h / 2 + 6, b.y));
        }
      }
      n.style.left = `${b.x - b.w / 2}px`;
      n.style.top = `${b.y - b.h / 2}px`;
      const amp = reduceMotion.matches ? 0 : BOB;
      n.style.translate = `${(Math.sin(t * b.f1 + b.p1) * amp).toFixed(2)}px ${(Math.cos(t * b.f2 + b.p2) * amp).toFixed(2)}px`;
    });
  }

  function clearGameNodes() {
    const old = gameNodes;
    gameNodes = [];
    slideOut(old);
  }

  function clearCenter() {
    const old = centerNodes;
    centerNodes = [];
    slideOut(old);
  }

  // the selected game's cover and stickers sit in the middle of the panel, among its creators
  function showCenter(pick) {
    clearCenter();
    const nodes = [];
    if (pick.cover) {
      const cover = el('div', 'team-cover');
      cover.dataset.src = pick.cover;
      preload(pick.cover);
      cover.appendChild(makeImg(pick.cover, pick.title, 'team-cover-img'));
      container.appendChild(cover);
      nodes.push(cover);
    }
    (pick.stickers ?? []).forEach((src, i) => {
      const node = buildPlanet({ game: { title: pick.title }, sticker: src }, i);
      node.classList.add('team-game--center');
      node.style.setProperty('--rot', `${i % 2 ? 3 : -3}deg`);
      nodes.push(node);
    });
    centerNodes = nodes;
  }

  function layoutCenter(w, h) {
    if (!centerNodes.length) return;
    const cover = centerNodes.find(n => n.classList.contains('team-cover'));
    const stickers = centerNodes.filter(n => n !== cover);
    const gap = 16;
    let coverW = 0;
    let coverH = 0;
    if (cover) {
      const aspect = aspects.get(cover.dataset.src) || 2.1;
      coverW = Math.min(w * 0.5, 260);
      coverH = coverW / aspect;
    }
    const n = stickers.length;
    let each = Math.min(w * 0.28, h * 0.17) * (n > 1 ? 0.78 : 1);
    if (n > 1) each = Math.min(each, (w * 0.6 - gap * (n - 1)) / n);
    const sizes = stickers.map(node => {
      const aspect = aspects.get(node.dataset.src) || 1;
      const ww = aspect >= 1 ? each : each * aspect;
      return { node, ww, hh: ww / aspect };
    });
    const rowH = sizes.length ? Math.max(...sizes.map(s => s.hh)) : 0;
    const stackH = coverH + (cover && sizes.length ? gap : 0) + rowH;
    let y = h / 2 - stackH / 2;
    if (cover) {
      placeNode(cover, w / 2, y + coverH / 2, coverW, coverH, true);
      y += coverH + gap;
    }
    const rowW = sizes.reduce((sum, s) => sum + s.ww, 0) + gap * Math.max(0, sizes.length - 1);
    let x = w / 2 - rowW / 2;
    sizes.forEach(({ node, ww, hh }) => {
      placeNode(node, x + ww / 2, y + rowH / 2, ww, hh);
      x += ww + gap;
    });
  }

  function enterSolar(name) {
    clearTimeout(solarTimer);
    clearGameNodes();
    const lower = name.toLowerCase();
    const games = gamesData.filter(g => !g.draft && (g.credits ?? []).some(c => c.toLowerCase() === lower));
    const names = new Set(games.flatMap(g => g.credits ?? []).map(c => c.toLowerCase()));
    names.delete(lower);
    const collab = devs.filter(d => !d.launch && names.has(d.item.name.toLowerCase()));
    const planets = games.flatMap(g => (stickersOf(g).length ? stickersOf(g).map(sticker => ({ game: g, sticker })) : [{ game: g }]));
    solar = { name, games, planets, collab, shown: false };
    gameNodes = planets.map(buildPlanet);
    // everyone else hides first, then the collaborators come back smaller around the games
    solarTimer = setTimeout(() => { if (solar) { solar.shown = true; arrange(); } }, 520);
  }

  function leaveSolar() {
    clearTimeout(solarTimer);
    solar = null;
    clearGameNodes();
    devs.forEach(resetSolarLook);
  }

  function arrangeSolar(w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.max(44, Math.min(84, Math.min(w, h) * 0.15));
    const small = Math.round(base * 0.52);
    size = base;
    container.style.setProperty('--node-size', `${base}px`);

    devs.forEach(d => { d.ta = 0; });
    const center = devs.find(d => !d.launch && d.item.name === solar.name);
    if (center) { center.ta = 1; center.tx = cx; center.ty = cy; center.sz = undefined; }

    // games on an ellipse around the middle
    const n = solar.planets.length;
    const rx1 = (w / 2) * 0.55;
    const ry1 = (h / 2) * 0.44;
    const angles = solar.planets.map((_, i) => -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2);
    const pts = angles.map(a => ({ x: cx + Math.cos(a) * rx1, y: cy + Math.sin(a) * ry1 }));
    let gap = w * 0.25;
    if (n > 1) gap = Math.min(...pts.map((p, i) => Math.hypot(p.x - pts[(i + 1) % n].x, p.y - pts[(i + 1) % n].y)));
    const gD = Math.max(40, Math.min(w * 0.17, gap * 0.8));
    gameNodes.forEach((node, i) => {
      const aspect = node.dataset.src ? aspects.get(node.dataset.src) || 1 : 1;
      const ww = aspect >= 1 ? gD : gD * aspect;
      placeNode(node, pts[i].x, pts[i].y, ww, ww / aspect);
    });

    // collaborators: one each, on the outer ring at the average angle of the games they worked on
    const rx2 = w / 2 - small / 2 - 12;
    const ry2 = Math.min(h / 2 - small / 2 - 26, ry1 * (rx2 / rx1));
    const placed = solar.collab.map(d => {
      const mine = solar.planets.map((p, i) => ((p.game.credits ?? []).some(c => c.toLowerCase() === d.item.name.toLowerCase()) ? i : -1)).filter(i => i >= 0);
      const sx = mine.reduce((sum, i) => sum + Math.cos(angles[i]), 0);
      const sy = mine.reduce((sum, i) => sum + Math.sin(angles[i]), 0);
      return { d, t: Math.atan2(sy, sx) };
    }).sort((a, b) => a.t - b.t);
    const minSep = Math.min(Math.PI, (small + 26) / ((rx2 + ry2) / 2));
    for (let pass = 0; pass < 60 && placed.length > 1; pass++) {
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i];
        const b = placed[(i + 1) % placed.length];
        let d = b.t - a.t;
        if (i === placed.length - 1) d += Math.PI * 2;
        if (d < minSep) {
          const push = (minSep - d) / 2;
          a.t -= push;
          b.t += push;
        }
      }
    }
    placed.forEach(({ d, t }) => {
      d.tx = cx + Math.cos(t) * rx2;
      d.ty = cy + Math.sin(t) * ry2;
      d.sz = small;
      d.node.style.setProperty('--node-size', `${small}px`);
      d.node.classList.add('team-node--small');
      d.ta = solar.shown ? 1 : 0;
      if (!d.solarPlaced) { d.solarPlaced = true; d.x = d.tx; d.y = d.ty; d.vx = 0; d.vy = 0; }
    });
    devs.forEach(d => { if (d.tx === undefined) { d.tx = cx; d.ty = cy; } });
    updateAnchors();
  }

  // Clicking a creator selects them: their node is outlined and their games are outlined in the grid
  function selectPerson(name) {
    clearTimeout(release);
    selectedPerson = selectedPerson === name ? null : name;
    selected = false;
    focus = null;
    projectRoles = {};
    launchActive = new Set();
    markSelectedPerson();
    clearCenter();
    if (selectedPerson) enterSolar(selectedPerson);
    else leaveSolar();
    arrange();
    window.dispatchEvent(new CustomEvent('person:select', { detail: selectedPerson }));
  }

  window.addEventListener('team:focus', e => {
    if (selected || solar) return;
    clearTimeout(release);
    const credits = e.detail?.credits;
    const next = credits?.length ? new Set(credits.map(n => n.toLowerCase())) : null;
    if (next) { focus = next; projectRoles = e.detail.roles ?? {}; arrange(); return; }
    release = setTimeout(() => { focus = null; projectRoles = {}; arrange(); }, RELEASE_MS);
  });

  window.addEventListener('person:clear', () => { if (selectedPerson) selectPerson(selectedPerson); });

  container.addEventListener('click', e => {
    if (selectedPerson && !e.target.closest('.team-node')) selectPerson(selectedPerson);
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
        links: links ? links.offsetHeight + parseFloat(getComputedStyle(links).marginTop) : 0, x: 0, y: 0, a: 0, ta: 1 };
      setChips(d, d.roles);
      return d;
    });
    ['bbox', 'itch', 'steam'].forEach(kind => {
      const node = buildLaunchNode(kind);
      node.style.setProperty('--delay', '0ms');
      container.appendChild(node);
      const d = { item: { name: `__launch-${kind}__`, roles: [], links: {} }, launch: true, node,
        label: node.querySelector('.team-node-label'), roles: [], links: 0, x: 0, y: 0, a: 0, ta: 0 };
      launchDevs[kind] = d;
      devs.push(d);
    });
    buildWeb();
    arrange();
    requestAnimationFrame(tick);
  })();
})();
