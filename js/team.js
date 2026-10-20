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
  const EASE          = 0.12;
  const FADE          = 36;
  const GAP           = 10;

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
  let size = 72;
  let snap = true;

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
    node.appendChild(circle);

    const label = el('div', 'team-node-label');
    label.appendChild(text('p', 'team-node-name', item.name));
    label.appendChild(text('p', 'team-node-role', item.role));

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

  function grid(n, w, h, cols) {
    const rows = Math.ceil(n / cols);
    const pts = [];
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - r * cols);
      for (let c = 0; c < inRow; c++) {
        pts.push({ x: (w / cols) * (c + 0.5 + (cols - inRow) / 2), y: (h / rows) * (r + 0.42) });
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

  function arrange() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || !devs.length) return;

    let shown = devs.filter(d => !focus || focus.has(d.item.name.toLowerCase()));
    if (!shown.length) shown = devs;
    devs.forEach(d => { d.ta = shown.includes(d) ? 1 : 0; });

    const base = Math.max(44, Math.min(84, Math.min(w, h) * 0.15));
    shown.forEach(d => { d.w = d.label.offsetWidth; d.h = d.label.offsetHeight - d.links; });
    const cellW = Math.max(...shown.map(d => d.w));
    const labelH = Math.max(...shown.map(d => d.h));
    const sizes = [];
    for (let s = base; s >= 44; s -= 4) sizes.push(s);
    let best = null;
    for (const s of sizes) {
      for (let k = Math.min(1, 0.35 + 0.1 * shown.length); k <= 1.001 && !best; k += 0.05) {
        const pts = slots(shown.length, w, h, s, Math.max(s, cellW), labelH, k);
        if (fits(pts, s, shown, w, h)) best = { s, pts };
      }
      if (best) break;
    }
    for (const s of [...sizes, 40, 36]) {
      for (let cols = 2; cols < shown.length && !best; cols++) {
        const pts = grid(shown.length, w, h, cols);
        if (fits(pts, s, shown, w, h)) best = { s, pts };
      }
      if (best) break;
    }
    if (!best) best = { s: 36, pts: slots(shown.length, w, h, 36, Math.max(36, cellW), labelH, 1) };
    size = best.s;
    container.style.setProperty('--node-size', `${size}px`);
    shown.forEach((d, i) => { d.tx = best.pts[i].x; d.ty = best.pts[i].y; });
    devs.forEach(d => {
      if (d.tx === undefined) { d.tx = w / 2; d.ty = h / 2; }
      if (snap) { d.x = d.tx; d.y = d.ty; d.a = d.ta; }
    });
    snap = false;
  }

  function nearDev(p) {
    let a = 1;
    devs.forEach(d => {
      if (d.a < 0.01) return;
      const b = box(d, size, d);
      const dx = Math.max(b.l - p.x, 0, p.x - b.r);
      const dy = Math.max(b.t - p.y, 0, p.y - b.b);
      const fade = Math.min(1, Math.hypot(dx, dy) / FADE);
      a = Math.min(a, 1 - d.a * (1 - fade));
    });
    return a;
  }

  function tick(t) {
    const drift = reduceMotion.matches ? 0 : DRIFT;
    devs.forEach(d => {
      d.x += (d.tx - d.x) * EASE;
      d.y += (d.ty - d.y) * EASE;
      d.a += (d.ta - d.a) * EASE;
      d.node.style.left = `${d.x - size / 2}px`;
      d.node.style.top = `${d.y - size / 2}px`;
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

    const open = decor.filter(p => p.a > 0.6);
    devs.forEach((d, i) => {
      const ids = d.a > 0.01 ? nearest(d, open, DEV_K) : [];
      for (let k = 0; k < DEV_K; k++) {
        const line = devLines[i * DEV_K + k];
        const q = open[ids[k]];
        if (!line) continue;
        if (!q) { line.style.opacity = 0; continue; }
        line.setAttribute('x1', d.x.toFixed(1));
        line.setAttribute('y1', d.y.toFixed(1));
        line.setAttribute('x2', q.x.toFixed(1));
        line.setAttribute('y2', q.y.toFixed(1));
        line.style.opacity = (0.55 * d.a * q.a).toFixed(3);
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

  window.addEventListener('team:focus', e => {
    focus = e.detail?.length ? new Set(e.detail.map(n => n.toLowerCase())) : null;
    arrange();
  });

  // ── Load people ────────────────────────────────────────────────────────────
  (async () => {
    let items;
    try {
      const res = await fetch('data/people.json');
      items = await res.json();
    } catch (e) {
      console.warn('team: failed to load people.json', e);
      return;
    }

    devs = items.map((item, i) => {
      const node = buildDevNode(item);
      node.style.setProperty('--delay', `${i * 60}ms`);
      container.appendChild(node);
      const links = node.querySelector('.team-node-links');
      return { item, node, label: node.querySelector('.team-node-label'),
        links: links ? links.offsetHeight + parseFloat(getComputedStyle(links).marginTop) : 0, x: 0, y: 0, a: 0, ta: 1 };
    });
    buildWeb();
    arrange();
    requestAnimationFrame(tick);
  })();
})();
