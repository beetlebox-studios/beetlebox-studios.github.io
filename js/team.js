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
  const DEV_K         = 4;    // edges from each dev node to its k nearest decor nodes
  const DECOR_R       = 2.2;  // px — decor node radius
  const SEED          = 1337; // fixed seed → same web every load

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

  let devs = []; // [{ item, node }]

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
    const node = el('div', item.founder ? 'team-node team-node--founder' : 'team-node');

    const circle = el('div', 'team-node-circle');
    if (item.image) {
      circle.appendChild(makeImg(item.image, item.name, 'team-node-photo'));
    } else {
      circle.appendChild(monogram(item.name));
    }
    node.appendChild(circle);

    if (item.founder) {
      const badge = el('span', 'team-node-founder');
      badge.title = 'Founding member';
      badge.setAttribute('aria-label', 'Founding member');
      badge.innerHTML = '<i class="fa-solid fa-star"></i>';
      node.appendChild(badge);
    }

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
  function layout() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || !devs.length) return;

    // Dev node size scales with the panel; ring leaves room for labels below
    const size   = Math.max(44, Math.min(84, Math.min(w, h) * 0.15));
    const labelH = 40;
    const cx = w / 2;
    const cy = h / 2 - labelH / 4;
    const radius = Math.max(0, Math.min(w / 2 - size * 0.9, h / 2 - size / 2 - labelH));

    container.style.setProperty('--node-size', `${size}px`);

    const devPts = devs.map((d, i) => {
      const a = -Math.PI / 2 + (i / devs.length) * Math.PI * 2;
      const p = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
      d.node.style.left = `${p.x - size / 2}px`;
      d.node.style.top  = `${p.y - size / 2}px`;
      return p;
    });

    // Decor nodes avoid dev circles and their labels
    const clear  = size / 2 + 10;
    const clearX = Math.max(clear, 60); // labels are wider than the circle
    const blocked = p => devPts.some(d =>
      Math.abs(p.x - d.x) < clearX && p.y > d.y - clear && p.y < d.y + clear + labelH);
    const decor = poisson(w, h, DECOR_SPACING, blocked, rng(SEED));

    // Edges (deduped) — decor↔decor k-nearest, dev→decor k-nearest
    const edges = new Map();
    const addEdge = (a, b, kind) => {
      const key = a.x < b.x || (a.x === b.x && a.y < b.y)
        ? `${a.x},${a.y}|${b.x},${b.y}` : `${b.x},${b.y}|${a.x},${a.y}`;
      if (!edges.has(key)) edges.set(key, { a, b, kind });
    };
    decor.forEach((p, i) => nearest(p, decor, DECOR_K, i).forEach(j => addEdge(p, decor[j], 'decor')));
    devPts.forEach(p => nearest(p, decor, DEV_K).forEach(j => addEdge(p, decor[j], 'dev')));
    const founderPts = devPts.filter((p, i) => devs[i].item.founder);
    founderPts.slice(1).forEach((p, i) => addEdge(founderPts[i], p, 'founder'));

    // Render SVG
    const maxLen = DECOR_SPACING * 2.5;
    let out = '';
    edges.forEach(({ a, b, kind }) => {
      const len = Math.hypot(a.x - b.x, a.y - b.y);
      const alpha = kind === 'founder' ? 0.9 : kind === 'dev' ? 0.55 : Math.max(0.12, 0.5 * (1 - len / maxLen));
      out += `<line class="team-web-edge team-web-edge--${kind}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" style="opacity:${alpha.toFixed(2)}"/>`;
    });
    decor.forEach(p => {
      out += `<circle class="team-web-node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${DECOR_R}"/>`;
    });
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = out;
  }

  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layout);
  }).observe(container);

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

    GRID_REGISTRY['people-grid'] = [];
    devs = items.map((item, i) => {
      const node = buildDevNode(item);
      node.style.setProperty('--delay', `${i * 60}ms`);
      container.appendChild(node);
      // `card` key lets the game-card credit filter (cards.js) dim nodes
      GRID_REGISTRY['people-grid'].push({ item, card: node });
      return { item, node };
    });
    layout();
  })();
})();
