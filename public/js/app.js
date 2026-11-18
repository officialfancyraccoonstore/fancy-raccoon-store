/* Fancy Raccoon storefront */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const esc = (v) =>
    String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const CART_KEY = 'fr:cart:v1';
  const AFFINITY_KEY = 'fr:affinity:v1';

  const state = {
    products: [],
    pricing: { customizationFee: 99, shippingFlat: 79, freeShippingOver: 1499 },
    cart: [],
    filters: { q: '', category: 'all', team: 'all', league: 'all', variant: 'fan', sort: 'featured' },
    active: null,
    affinity: { teams: {}, categories: {}, variants: {} },
  };

  /* ------------------------------------------------------------ storage */
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage may be unavailable */
    }
  }

  function loadCart() {
    const cart = readJSON(CART_KEY, []);
    return Array.isArray(cart) ? cart.filter((item) => item && item.productId) : [];
  }

  /* -------------------------------------------------------------- toast */
  let toastTimer;
  function toast(message, kind = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast show${kind === 'err' ? ' err' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 3200);
  }

  /* ---------------------------------------------------------- jersey art */
  const BODY_PATH =
    'M150 34c-14 0-26 4-36 10l-46 18c-16 6-24 22-21 38l11 40c2 9 12 11 19 5l19-19v130c0 8 6 14 14 16 25 6 65 6 90 0 8-2 14-8 14-16V126l19 19c7 6 17 4 19-5l11-40c3-16-5-32-21-38l-46-18c-10-6-22-10-36-10z';

  function luminance(hex) {
    const clean = String(hex || '#000').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const r = parseInt(full.slice(0, 2), 16) || 0;
    const g = parseInt(full.slice(2, 4), 16) || 0;
    const b = parseInt(full.slice(4, 6), 16) || 0;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  let artId = 0;
  function jerseySVG(product, opts = {}) {
    const colors = (product && product.colors) || { primary: '#1a1d24', secondary: '#2a2e38', accent: '#c8ff4d' };
    const { primary, secondary, accent } = colors;
    const id = `j${++artId}`;
    const ink = luminance(primary) > 0.62 ? 'rgba(12,14,18,.82)' : 'rgba(255,255,255,.94)';
    let pattern = '';
    switch (product && product.pattern) {
      case 'stripes':
        pattern = Array.from({ length: 7 }, (_, i) => `<rect x="${i * 44}" y="0" width="23" height="320" fill="${secondary}"/>`).join('');
        break;
      case 'halves':
        pattern = `<rect x="150" y="0" width="160" height="320" fill="${secondary}"/>`;
        break;
      case 'sash':
        pattern = `<rect x="-90" y="112" width="480" height="48" fill="${secondary}" transform="rotate(-24 150 160)"/>`;
        break;
      case 'hoops':
        pattern = Array.from({ length: 5 }, (_, i) => `<rect x="0" y="${44 + i * 52}" width="300" height="24" fill="${secondary}"/>`).join('');
        break;
      default:
        pattern = '';
    }

    const name = (opts.name || '').trim().toUpperCase();
    const number = (opts.number || '').trim();
    const label = name
      ? `<text x="150" y="196" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${name.length > 10 ? 15 : 19}" font-weight="700" letter-spacing="1.5" fill="${ink}" opacity=".92">${esc(name)}</text>`
      : '';
    const num = number
      ? `<text x="150" y="262" text-anchor="middle" font-family="Anton,Impact,Arial Narrow,sans-serif" font-size="62" fill="${ink}" opacity=".95">${esc(number)}</text>`
      : `<text x="150" y="258" text-anchor="middle" font-family="Anton,Impact,Arial Narrow,sans-serif" font-size="34" fill="${ink}" opacity=".22">FR</text>`;

    return `<svg viewBox="0 0 300 320" role="img" aria-label="${esc((product && product.name) || 'Jersey')}">
      <defs>
        <clipPath id="${id}-clip"><path d="${BODY_PATH}"/></clipPath>
        <linearGradient id="${id}-shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fff" stop-opacity=".16"/>
          <stop offset="46%" stop-color="#fff" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000" stop-opacity=".26"/>
        </linearGradient>
      </defs>
      <ellipse cx="150" cy="306" rx="88" ry="8" fill="rgba(0,0,0,.35)"/>
      <g>
        <path d="${BODY_PATH}" fill="${primary}"/>
        <g clip-path="url(#${id}-clip)">${pattern}</g>
        <rect x="94" y="132" width="5" height="142" fill="${accent}" opacity=".85"/>
        <rect x="201" y="132" width="5" height="142" fill="${accent}" opacity=".85"/>
        <path d="M116 40c9 6 21 9 34 9s25-3 34-9l-7 15c-9 4-18 6-27 6s-18-2-27-6z" fill="${accent}"/>
        <circle cx="119" cy="118" r="9" fill="${accent}" opacity=".9"/>
        <circle cx="119" cy="118" r="9" fill="none" stroke="${ink}" stroke-width="1.4" opacity=".5"/>
        <path d="${BODY_PATH}" fill="url(#${id}-shade)"/>
        <path d="${BODY_PATH}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>
        ${label}
        ${num}
      </g>
    </svg>`;
  }

  /* --------------------------------------------------------------- api */
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || 'Something went wrong. Please try again.');
    }
    return data;
  }

  /* --------------------------------------------------------- affinity */
  function loadAffinity() {
    const stored = readJSON(AFFINITY_KEY, null);
    if (stored && stored.teams && stored.categories && stored.variants) return stored;
    return { teams: {}, categories: {}, variants: {} };
  }

  function bumpAffinity(product, variant) {
    if (!product) return;
    const a = state.affinity;
    a.teams[product.team] = (a.teams[product.team] || 0) + 1;
    a.categories[product.category] = (a.categories[product.category] || 0) + 1;
    a.variants[variant] = (a.variants[variant] || 0) + 1;
    writeJSON(AFFINITY_KEY, a);
    renderPicks();
  }

  /* ----------------------------------------------------------- pricing */
  function unitPrice(product, variant, printName, printNumber) {
    const base = product.prices[variant];
    if (typeof base !== 'number') return null;
    const custom = printName || printNumber ? state.pricing.customizationFee : 0;
    return base + custom;
  }

  function cartTotals(cart) {
    let subtotal = 0;
    for (const item of cart) {
      const product = state.products.find((p) => p.id === item.productId);
      if (!product) continue;
      const unit = unitPrice(product, item.variant, item.printName, item.printNumber) || 0;
      subtotal += unit * item.qty;
    }
    const shipping = subtotal === 0 || subtotal >= state.pricing.freeShippingOver ? 0 : state.pricing.shippingFlat;
    return { subtotal, shipping, total: subtotal + shipping, count: cart.reduce((n, i) => n + i.qty, 0) };
  }

  /* ------------------------------------------------------------ render */
  const teamInitials = (teamName) =>
    teamName
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
      .toUpperCase();

  function renderHero() {
    const picks = ['india-home', 'rm-home-2526', 'bar-home-2526', 'argentina-home']
      .map((id) => state.products.find((p) => p.id === id))
      .filter(Boolean);
    const stack = picks.length ? picks : state.products.slice(0, 3);
    $('#heroStack').innerHTML = stack
      .slice(0, 3)
      .map((p) => `<div class="stack-item">${jerseySVG(p)}</div>`)
      .join('');
  }

  function renderTeams() {
    const league = state.filters.league;
    const teams = [];
    const seen = new Set();
    for (const product of state.products) {
      if (league !== 'all' && product.league !== league) continue;
      if (seen.has(product.team)) continue;
      seen.add(product.team);
      teams.push(product);
    }
    teams.sort((a, b) => b.sold - a.sold);
    const shown = league === 'all' ? teams.slice(0, 24) : teams;

    $('#teamRail').innerHTML = shown
      .map(
        (p) => `<button class="team-card" type="button" data-team="${esc(p.team)}">
          <span class="team-dot" style="background:linear-gradient(140deg,${esc(p.colors.primary)},${esc(p.colors.secondary)})">${teamInitials(p.team)}</span>
          <span><strong>${esc(p.team)}</strong><span>${esc(p.league || (p.category === 'club' ? 'Club' : 'National team'))}</span></span>
        </button>`
      )
      .join('');

    const chips = ['All teams', ...shown.map((p) => p.team)];
    $('#teamChips').innerHTML = chips
      .map(
        (team) =>
          `<button class="chip${(team === 'All teams' && state.filters.team === 'all') || state.filters.team === team ? ' is-active' : ''}" type="button" data-chip-team="${esc(team)}">${esc(team)}</button>`
      )
      .join('');
  }

  function productVisual(product, opts = {}) {
    const svg = jerseySVG(product, opts);
    const src = product && (product.image || product.photo);
    if (src) {
      return `<div class="pv-wrap" style="display:contents"><img src="${esc(src)}" alt="${esc(product.name)}" loading="lazy" style="width:88%;height:auto;object-fit:contain;filter:drop-shadow(0 18px 26px rgba(0,0,0,.55));" onerror="this.remove()"><span class="pv-fallback" style="display:none"></span></div>`;
    }
    return svg;
  }

  function stockLabel(product) {
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
    if (stock <= 0) return '<span style="color:#ff8b8b">Out of stock</span>';
    return `${stock} in stock`;
  }

  function productCard(product) {
    const variant = product.prices[state.filters.variant] != null ? state.filters.variant : 'fan';
    const price = product.prices[variant];
    const genuine = product.prices.genuine;
    return `<article class="product-card" data-product="${esc(product.id)}" tabindex="0" role="button" aria-label="${esc(product.name)}">
      <div class="pc-visual">
        ${product.badge ? `<span class="pc-badge${variant === 'genuine' ? ' pc-badge--gold' : ''}">${esc(product.badge)}</span>` : variant === 'genuine' ? '<span class="pc-badge pc-badge--gold">Original</span>' : ''}
        ${productVisual(product)}
      </div>
      <div class="pc-body">
        <span class="pc-team">${esc(product.team)} · ${esc(product.league || (product.category === 'club' ? 'Club' : 'National'))}</span>
        <h3 class="pc-name">${esc(product.name)}</h3>
        <div class="pc-meta"><span class="star">★</span>${product.rating.toFixed(1)} <span>·</span> ${stockLabel(product)}</div>
        <div class="pc-bottom">
          <div class="pc-price">
            <strong>${money(price)}</strong>
            <small>${genuine ? `Original ${money(genuine)}` : 'Fan-made look-alike'}</small>
          </div>
          <button class="pc-cta" type="button" data-open="${esc(product.id)}">Customise</button>
        </div>
      </div>
    </article>`;
  }

  function filteredProducts() {
    const { q, category, team, league, variant, sort } = state.filters;
    let list = state.products.slice();
    if (category !== 'all') list = list.filter((p) => p.category === category);
    if (league !== 'all') list = list.filter((p) => p.league === league);
    if (team !== 'all') list = list.filter((p) => p.team === team);
    if (variant === 'genuine') list = list.filter((p) => typeof p.prices.genuine === 'number');
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((p) =>
        [p.name, p.team, p.category, p.league, p.kit, p.blurb].join(' ').toLowerCase().includes(needle)
      );
    }
    switch (sort) {
      case 'price-asc':
        list.sort((a, b) => a.prices[variant] - b.prices[variant]);
        break;
      case 'price-desc':
        list.sort((a, b) => b.prices[variant] - a.prices[variant]);
        break;
      case 'rating':
        list.sort((a, b) => b.rating - a.rating);
        break;
      case 'sold':
        list.sort((a, b) => b.sold - a.sold);
        break;
      default:
        list.sort((a, b) => a.position - b.position);
    }
    return list;
  }

  function renderGrid() {
    const list = filteredProducts();
    $('#productGrid').innerHTML = list.map(productCard).join('');
    $('#emptyState').hidden = list.length > 0;
  }

  function renderPicks() {
    if (!state.products.length) return;
    const a = state.affinity;
    const favouriteTeam = Object.entries(a.teams).sort((x, y) => y[1] - x[1])[0];
    const scored = state.products
      .map((p) => ({
        p,
        score:
          (a.teams[p.team] || 0) * 6 +
          (a.categories[p.category] || 0) * 3 +
          (a.variants[p.prices.genuine ? 'genuine' : 'fan'] || 0) * 2 +
          p.rating * 2 +
          p.sold / 260,
      }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)
      .map((row) => row.p);

    $('#picksRail').innerHTML = scored.map(productCard).join('');
    if (favouriteTeam && favouriteTeam[1] >= 2) {
      $('#picksNote').textContent = `Because you keep coming back to ${favouriteTeam[0]} — and a few others worth a look.`;
    } else {
      $('#picksNote').textContent = 'A few kits we think you will wear all season. Browse a jersey and this row adapts to you.';
    }
  }

  /* --------------------------------------------------------- 3D rack */
  const stageState = { items: [], index: 0, angle: 0, step: 45, dragging: false, visible: true, raf: 0, last: 0, front: -1, pausedUntil: 0 };
  let stageObserver = null;
  let stageSnapTimer = 0;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stageFront() {
    const n = stageState.items.length || 1;
    return ((Math.round(stageState.angle / stageState.step) % n) + n) % n;
  }

  function stagePicks() {
    const seen = new Set();
    const out = [];
    const ranked = state.products.slice().sort((a, b) => (b.sold || 0) - (a.sold || 0));
    for (const p of ranked) {
      if (seen.has(p.team)) continue;
      seen.add(p.team);
      out.push(p);
      if (out.length === 8) break;
    }
    return out;
  }

  function sizeStage() {
    const ring = $('#stageRing');
    if (!ring || !stageState.items.length) return;
    const w = window.innerWidth;
    const cardW = w < 620 ? 150 : w < 1000 ? 168 : 190;
    const radius = Math.round(cardW / 2 / Math.tan(Math.PI / stageState.items.length)) + (w < 620 ? 30 : 90);
    ring.style.setProperty('--cw', `${cardW}px`);
    ring.style.setProperty('--ch', `${Math.round(cardW * 1.42)}px`);
    ring.style.setProperty('--radius', `${radius}px`);
    ring.style.setProperty('--step', `${stageState.step}deg`);
  }

  function paintStage() {
    const ring = $('#stageRing');
    if (!ring) return;
    ring.style.setProperty('--spin', String(-stageState.angle));
    const front = stageFront();
    if (front === stageState.front) return;
    stageState.front = front;
    $$('#stageRing .stage-card').forEach((card, i) => card.classList.toggle('is-active', i === front));
    const count = $('#stageCount');
    if (count) count.textContent = `${front + 1} / ${stageState.items.length} kits`;
  }

  function stageSnapTo(target) {
    const ring = $('#stageRing');
    const n = stageState.items.length;
    if (!ring || !n) return;
    const idx = ((Math.round(target) % n) + n) % n;
    let angle = Math.round(stageState.angle / 360) * 360 + idx * stageState.step;
    while (angle - stageState.angle > 180) angle -= 360;
    while (stageState.angle - angle > 180) angle += 360;
    stageState.angle = angle;
    stageState.index = idx;
    stageState.pausedUntil = Date.now() + 5000;
    ring.classList.add('is-snapping');
    paintStage();
    clearTimeout(stageSnapTimer);
    stageSnapTimer = setTimeout(() => ring.classList.remove('is-snapping'), 600);
  }

  function startStageAuto() {
    cancelAnimationFrame(stageState.raf);
    stageState.last = 0;
    if (reducedMotion()) return;
    const tick = (now) => {
      if (!stageState.last) stageState.last = now;
      const dt = Math.min(80, now - stageState.last) / 1000;
      stageState.last = now;
      const canSpin = !document.hidden && stageState.visible && !stageState.dragging && Date.now() > stageState.pausedUntil;
      if (canSpin) {
        stageState.angle += dt * 7;
        paintStage();
      }
      stageState.raf = requestAnimationFrame(tick);
    };
    stageState.raf = requestAnimationFrame(tick);
  }

  function renderShowcase() {
    const ring = $('#stageRing');
    if (!ring || !state.products.length) return;
    const picks = stagePicks();
    if (!picks.length) return;
    stageState.items = picks;
    stageState.step = 360 / picks.length;
    stageState.angle = 0;
    stageState.front = -1;
    stageState.index = 0;

    ring.innerHTML = picks
      .map(
        (p, i) => `<button class="stage-card" type="button" data-stage="${i}" style="--i:${i}" aria-label="Open ${esc(p.name)}">
          <span class="sc-visual">${jerseySVG(p)}</span>
          <span class="sc-team">${esc(p.team)}</span>
          <span class="sc-name">${esc(p.name)}</span>
          <span class="sc-price">${money(p.prices.fan)}<em>fan-made</em></span>
        </button>`
      )
      .join('');

    const parts = $('#stageParticles');
    if (parts) {
      const tones = ['var(--pop)', 'var(--ink)', 'var(--sw1)', 'var(--sw3)'];
      parts.innerHTML = Array.from(
        { length: 14 },
        (_, i) =>
          `<i style="left:${(i * 37 + 9) % 92}%;top:${(i * 53 + 6) % 84}%;--s:${5 + (i % 5) * 5}px;--dur:${11 + (i % 6) * 2}s;--delay:${(i % 7) * -1.7}s;--c:${tones[i % 4]}"></i>`
      ).join('');
    }

    sizeStage();
    paintStage();
    startStageAuto();
    if ('IntersectionObserver' in window) {
      if (stageObserver) stageObserver.disconnect();
      stageObserver = new IntersectionObserver(
        (entries) => entries.forEach((entry) => { stageState.visible = entry.isIntersecting; }),
        { threshold: 0.12 }
      );
      stageObserver.observe($('#stage'));
    }
  }

  function wireStage() {
    const el = $('#stage');
    if (!el || el.dataset.wired) return;
    el.dataset.wired = '1';
    let drag = null;

    el.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      drag = { x: event.clientX, angle: stageState.angle, moved: 0 };
      stageState.dragging = true;
      el.classList.add('is-dragging');
      if (el.setPointerCapture) el.setPointerCapture(event.pointerId);
    });

    el.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      stageState.angle = drag.angle - dx * 0.3;
      const ring = $('#stageRing');
      if (ring) ring.classList.remove('is-snapping');
      paintStage();
    });

    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      stageState.dragging = false;
      el.classList.remove('is-dragging');
      stageState.pausedUntil = Date.now() + 5000;
      if (moved > 8) {
        el.dataset.suppressClick = '1';
        setTimeout(() => {
          delete el.dataset.suppressClick;
        }, 80);
        stageSnapTo(Math.round(stageState.angle / stageState.step));
      }
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && !event.buttons) endDrag();
    });

    el.addEventListener('click', (event) => {
      const card = event.target.closest('[data-stage]');
      if (!card) return;
      if (el.dataset.suppressClick) {
        event.preventDefault();
        return;
      }
      const idx = Number(card.dataset.stage);
      if (idx !== stageFront()) {
        stageSnapTo(idx);
        return;
      }
      const product = stageState.items[idx];
      if (product) openProduct(product.id);
    });

    el.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stageSnapTo(stageFront() + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stageSnapTo(stageFront() - 1);
      }
    });

    const prev = $('#stagePrev');
    const next = $('#stageNext');
    if (prev) prev.addEventListener('click', () => stageSnapTo(stageFront() - 1));
    if (next) next.addEventListener('click', () => stageSnapTo(stageFront() + 1));

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        sizeStage();
        paintStage();
      }, 160);
    });
  }

  function renderCart() {
    const body = $('#cartBody');
    const totals = cartTotals(state.cart);
    $('#cartCount').textContent = String(totals.count);

    if (!state.cart.length) {
      body.innerHTML = `<div class="cart-empty"><strong>Nothing here yet</strong>Pick a jersey, add your name and number, and it will show up here.</div>`;
      $('#cartTotals').innerHTML = '';
      $('#checkoutBtn').disabled = true;
      return;
    }

    body.innerHTML = state.cart
      .map((item, index) => {
        const product = state.products.find((p) => p.id === item.productId);
        if (!product) return '';
        const unit = unitPrice(product, item.variant, item.printName, item.printNumber) || 0;
        const print = [item.printName, item.printNumber].filter(Boolean).join(' · ');
        const thumbs = (item.uploads || [])
          .map((u) => (u.preview ? `<img src="${u.preview}" alt="">` : ''))
          .join('');
        return `<div class="cart-item">
          <div class="ci-thumb">${product.image && !item.printName && !item.printNumber ? `<img src="${esc(product.image)}" alt="" style="width:100%;height:auto;object-fit:contain;">` : jerseySVG(product, { name: item.printName, number: item.printNumber })}</div>
          <div>
            <div class="ci-title">${esc(product.name)}</div>
            <div class="ci-meta">${esc(item.variant === 'genuine' ? 'Original / genuine' : 'Fan-made look-alike')} · Size ${esc(item.size)}</div>
            ${print ? `<div class="ci-print">${esc(print)}</div>` : ''}
            ${item.notes ? `<div class="ci-notes">${esc(item.notes)}</div>` : ''}
            ${thumbs ? `<div class="ci-thumbs">${thumbs}</div>` : ''}
            <button class="ci-remove" type="button" data-remove="${index}">Remove</button>
          </div>
          <div class="ci-right">
            <span class="ci-price">${money(unit * item.qty)}</span>
            <div class="ci-qty">
              <button type="button" data-dec="${index}" aria-label="Decrease">−</button>
              <span>${item.qty}</span>
              <button type="button" data-inc="${index}" aria-label="Increase">+</button>
            </div>
          </div>
        </div>`;
      })
      .join('');

    $('#cartTotals').innerHTML = `
      <div><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
      <div><span>Shipping</span><span class="${totals.shipping === 0 ? 'free' : ''}">${totals.shipping === 0 ? 'FREE' : money(totals.shipping)}</span></div>
      <div class="grand"><span>Total</span><span>${money(totals.total)}</span></div>`;
    $('#checkoutBtn').disabled = false;
  }

  /* ------------------------------------------------------- product modal */
  function openProduct(productId) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;
    const defaultVariant = product.prices.genuine && state.filters.variant === 'genuine' ? 'genuine' : 'fan';
    state.active = {
      product,
      variant: defaultVariant,
      size: product.sizes.includes('L') ? 'L' : product.sizes[0],
      qty: 1,
      printName: '',
      printNumber: '',
      notes: '',
      uploads: [],
    };
    bumpAffinity(product, defaultVariant);
    renderProductModal();
    openModal('#productModal');
  }

  function renderProductModal() {
    const a = state.active;
    if (!a) return;
    const { product } = a;
    $('#pmTeam').textContent = `${product.team} · ${product.category === 'club' ? 'European club' : 'National team'}`;
    $('#pmTitle').textContent = product.name;
    $('#pmBlurb').textContent = product.blurb;

    $('#pmVisual').innerHTML = (product.image && !a.printName && !a.printNumber)
      ? `<img src="${esc(product.image)}" alt="${esc(product.name)}" style="width:min(340px,100%);height:auto;object-fit:contain;filter:drop-shadow(0 30px 40px rgba(0,0,0,.6));">`
      : jerseySVG(product, { name: a.printName, number: a.printNumber });

    $('#pmVariants').innerHTML = ['fan', 'genuine']
      .filter((v) => typeof product.prices[v] === 'number')
      .map(
        (v) => `<button class="variant-btn${a.variant === v ? ' is-active' : ''}" type="button" data-variant="${v}">
          <strong>${v === 'fan' ? 'Fan-made look-alike' : 'Original / genuine'}</strong>
          <span>${money(product.prices[v])}</span>
        </button>`
      )
      .join('');

    const unit = unitPrice(product, a.variant, a.printName, a.printNumber);
    const customised = Boolean(a.printName || a.printNumber);
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
    $('#pmPrice').innerHTML = `<strong>${money(unit)}</strong><span>${customised ? `includes ${money(state.pricing.customizationFee)} print fee` : 'base price · add a name or number for ₹99'} · ${stock} in stock</span>`;
    $('#pmPrice').dataset.unit = String(unit);

    $('#pmSizes').innerHTML = product.sizes
      .map((s) => `<button class="size-pill${a.size === s ? ' is-active' : ''}" type="button" data-size="${s}">${s}</button>`)
      .join('');

    $('#pmName').value = a.printName;
    $('#pmNumber').value = a.printNumber;
    $('#pmNotes').value = a.notes;
    $('#pmQty').textContent = String(a.qty);
    updatePrintFee(customised);

    renderUploadList();
  }

  function updatePrintFee(customised) {
    const a = state.active;
    if (!a) return;
    $('#pmNote').textContent = customised
      ? `Customisation fee ${money(state.pricing.customizationFee)} applied · shipping free over ${money(state.pricing.freeShippingOver)}`
      : `Print fee ${money(state.pricing.customizationFee)} applies only when you add a name or number.`;
  }

  function updatePreview() {
    const a = state.active;
    if (!a) return;
    const product = a.product;
    const customised = Boolean(a.printName || a.printNumber);
    const unit = unitPrice(product, a.variant, a.printName, a.printNumber);
    $('#pmVisual').innerHTML = (product.image && !a.printName && !a.printNumber)
      ? `<img src="${esc(product.image)}" alt="${esc(product.name)}" style="width:min(340px,100%);height:auto;object-fit:contain;filter:drop-shadow(0 30px 40px rgba(0,0,0,.6));">`
      : jerseySVG(product, { name: a.printName, number: a.printNumber });
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
    $('#pmPrice').innerHTML = `<strong>${money(unit)}</strong><span>${
      customised ? `includes ${money(state.pricing.customizationFee)} print fee` : 'base price · add a name or number for ₹99'
    } · ${stock} in stock</span>`;
    updatePrintFee(customised);
  }

  function renderUploadList() {
    const a = state.active;
    if (!a) return;
    $('#uploadList').innerHTML = (a.uploads || [])
      .map(
        (u, i) => `<div class="upload-chip${u.pending ? ' is-loading' : ''}">
          <img src="${u.preview || ''}" alt="${esc(u.name)}">
          <button type="button" data-unupload="${i}" aria-label="Remove image">✕</button>
        </div>`
      )
      .join('');
  }

  async function handleFiles(fileList) {
    const a = state.active;
    if (!a) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = 6 - (a.uploads || []).length;
    if (room <= 0) {
      toast('You can attach up to 6 reference images.', 'err');
      return;
    }
    const chosen = files.slice(0, room);
    if (files.length > room) toast(`Only ${room} more image${room === 1 ? '' : 's'} could be attached.`, 'err');

    const pending = chosen.map((file) => ({
      id: null,
      name: file.name,
      preview: URL.createObjectURL(file),
      pending: true,
    }));
    a.uploads.push(...pending);
    renderUploadList();

    const form = new FormData();
    chosen.forEach((file) => form.append('images', file));
    try {
      const data = await api('/api/uploads', { method: 'POST', body: form });
      const saved = data.uploads || [];
      pending.forEach((entry, i) => {
        const match = saved[i];
        if (match) {
          entry.id = match.id;
          entry.name = match.name;
          entry.pending = false;
        }
      });
      a.uploads = a.uploads.filter((u) => !pending.includes(u) || u.id);
    } catch (err) {
      a.uploads = a.uploads.filter((u) => !pending.includes(u));
      toast(err.message, 'err');
    }
    renderUploadList();
  }

  function modalError(message) {
    const el = $('#coError');
    el.textContent = message;
    el.hidden = false;
  }

  /* --------------------------------------------------------- cart drawer */
  function openDrawer() {
    $('#scrim').hidden = false;
    requestAnimationFrame(() => {
      $('#scrim').classList.add('show');
      $('#cartDrawer').classList.add('open');
    });
    $('#cartDrawer').setAttribute('aria-hidden', 'false');
    document.body.classList.add('locked');
  }

  function closeDrawer() {
    $('#cartDrawer').classList.remove('open');
    $('#cartDrawer').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('show');
    document.body.classList.remove('locked');
    setTimeout(() => {
      if (!$('#cartDrawer').classList.contains('open')) $('#scrim').hidden = true;
    }, 280);
  }

  function openModal(selector) {
    const modal = $(selector);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => modal.classList.add('show'));
    document.body.classList.add('locked');
  }

  function closeModal(selector) {
    const modal = $(selector);
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('locked');
    setTimeout(() => {
      if (!modal.classList.contains('show')) modal.hidden = true;
    }, 220);
  }

  function addToCart() {
    const a = state.active;
    if (!a) return;
    const { product } = a;
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
    if (stock <= 0) {
      toast('This jersey is currently out of stock.', 'err');
      return;
    }
    if (a.qty > stock) {
      toast(`Only ${stock} of this jersey are left in stock.`, 'err');
      return;
    }
    const pendingUploads = (a.uploads || []).filter((u) => !u.id);
    if (pendingUploads.length) {
      toast('Hold on — your reference images are still uploading.', 'err');
      return;
    }
    const key = [product.id, a.variant, a.size, a.printName.toUpperCase(), a.printNumber, a.notes.trim(), (a.uploads || []).map((u) => u.id).join(',')].join('|');
    const existing = state.cart.find((item) => item.key === key);
    if (existing) {
      existing.qty = Math.min(20, existing.qty + a.qty);
    } else {
      state.cart.push({
        key,
        productId: product.id,
        variant: a.variant,
        size: a.size,
        qty: a.qty,
        printName: a.printName.trim().toUpperCase(),
        printNumber: a.printNumber.trim(),
        notes: a.notes.trim(),
        uploads: (a.uploads || []).map((u) => ({ id: u.id, name: u.name, preview: u.preview })),
      });
    }
    writeJSON(CART_KEY, state.cart.map((item) => ({ ...item, uploads: (item.uploads || []).map((u) => ({ id: u.id, name: u.name })) })));
    renderCart();
    closeModal('#productModal');
    openDrawer();
    toast(`${product.name} added to your cart.`);
  }

  /* ------------------------------------------------------------ checkout */
  function openCheckout() {
    if (!state.cart.length) return;
    closeDrawer();
    const totals = cartTotals(state.cart);
    $('#coSummary').innerHTML = `
      <div><span>${totals.count} jersey${totals.count === 1 ? '' : 's'} (customisation included)</span><span>${money(totals.subtotal)}</span></div>
      <div><span>Shipping</span><span>${totals.shipping === 0 ? 'FREE' : money(totals.shipping)}</span></div>
      <div class="grand"><span>Total payable</span><span>${money(totals.total)}</span></div>`;
    $('#checkoutView').hidden = false;
    $('#successView').hidden = true;
    $('#coError').hidden = true;
    openModal('#checkoutModal');
  }

  async function submitOrder(event) {
    event.preventDefault();
    const form = event.target;
    const submit = $('#coSubmit');
    const errorEl = $('#coError');
    errorEl.hidden = true;

    const data = new FormData(form);
    const customer = {
      name: (data.get('name') || '').trim(),
      email: (data.get('email') || '').trim(),
      phone: (data.get('phone') || '').trim(),
      address: (data.get('address') || '').trim(),
      city: (data.get('city') || '').trim(),
      state: (data.get('state') || '').trim(),
      pin: (data.get('pin') || '').trim(),
      country: data.get('country') || 'India',
    };
    const missing = ['name', 'email', 'phone', 'address', 'city'].filter((field) => !customer[field]);
    if (missing.length) {
      modalError('Please fill in your name, email, phone and full delivery address.');
      return;
    }

    const items = state.cart.map((item) => ({
      productId: item.productId,
      variant: item.variant,
      size: item.size,
      qty: item.qty,
      printName: item.printName,
      printNumber: item.printNumber,
      notes: item.notes,
      uploadIds: (item.uploads || []).map((u) => u.id).filter(Boolean),
    }));

    submit.disabled = true;
    submit.textContent = 'Placing order…';
    try {
      const res = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer,
          items,
          notes: (data.get('notes') || '').trim(),
          paymentMethod: data.get('paymentMethod') || 'cod',
        }),
      });
      state.cart = [];
      writeJSON(CART_KEY, []);
      renderCart();

      const order = res.order;
      $('#successCode').textContent = order.code;
      $('#successSummary').innerHTML = `
        <div><span>Order</span><span>${esc(order.code)}</span></div>
        <div><span>Items</span><span>${order.items.reduce((n, i) => n + i.qty, 0)}</span></div>
        <div><span>Shipping</span><span>${order.shipping ? money(order.shipping) : 'FREE'}</span></div>
        <div class="grand"><span>Total</span><span>${money(order.total)}</span></div>`;
      const emailed = res.email && res.email.status === 'sent';
      $('#successCopy').textContent = emailed
        ? `Your order and reference images have been sent to ${res.email.ownerEmail}, and a confirmation is on its way to ${order.customer.email}. Our team will send a print proof on WhatsApp within 24 hours.`
        : `Your order is confirmed and our studio has been notified. We'll send a print proof on WhatsApp within 24 hours. Save your order code ${order.code} — that's all you need if you want to check in.`;
      $('#checkoutView').hidden = true;
      $('#successView').hidden = false;
      form.reset();
    } catch (err) {
      modalError(err.message);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Place order';
    }
  }

  /* --------------------------------------------------------------- wire */
  function wire() {
    $('#cartOpen').addEventListener('click', openDrawer);
    $('#cartClose').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);

    $('#cartBody').addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-remove]');
      const incBtn = event.target.closest('[data-inc]');
      const decBtn = event.target.closest('[data-dec]');
      if (removeBtn) {
        state.cart.splice(Number(removeBtn.dataset.remove), 1);
        persistCart();
      } else if (incBtn) {
        const item = state.cart[Number(incBtn.dataset.inc)];
        if (item) item.qty = Math.min(20, item.qty + 1);
        persistCart();
      } else if (decBtn) {
        const index = Number(decBtn.dataset.dec);
        const item = state.cart[index];
        if (item) {
          item.qty -= 1;
          if (item.qty <= 0) state.cart.splice(index, 1);
        }
        persistCart();
      }
    });

    $('#categorySeg').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-category]');
      if (!btn) return;
      state.filters.category = btn.dataset.category;
      $$('#categorySeg button').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderGrid();
    });

    $('#variantSeg').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-variant]');
      if (!btn) return;
      state.filters.variant = btn.dataset.variant;
      $$('#variantSeg button').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderGrid();
    });

    $('#searchInput').addEventListener('input', (event) => {
      state.filters.q = event.target.value;
      renderGrid();
    });

    $('#leagueSelect').addEventListener('change', (event) => {
      state.filters.league = event.target.value;
      state.filters.team = 'all';
      renderTeams();
      renderGrid();
    });

    $('#sortSelect').addEventListener('change', (event) => {
      state.filters.sort = event.target.value;
      renderGrid();
    });

    $('#teamChips').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-chip-team]');
      if (!btn) return;
      const team = btn.dataset.chipTeam;
      state.filters.team = team === 'All teams' ? 'all' : team;
      renderTeams();
      renderGrid();
    });

    $('#teamRail').addEventListener('click', (event) => {
      const card = event.target.closest('[data-team]');
      if (!card) return;
      state.filters.team = card.dataset.team;
      renderTeams();
      renderGrid();
      document.getElementById('collection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const gridHandler = (event) => {
      const openBtn = event.target.closest('[data-open]');
      const card = event.target.closest('[data-product]');
      const id = openBtn ? openBtn.dataset.open : card && card.dataset.product;
      if (id) openProduct(id);
    };
    $('#productGrid').addEventListener('click', gridHandler);
    $('#picksRail').addEventListener('click', gridHandler);
    $('#productGrid').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const card = event.target.closest('[data-product]');
      if (card) openProduct(card.dataset.product);
    });

    $$('[data-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.variant = btn.dataset.jump;
        $$('#variantSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.variant === state.filters.variant));
        renderGrid();
        document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
      });
    });

    $('#heroCustomise').addEventListener('click', () => {
      const product = state.products.find((p) => p.prices.genuine) || state.products[0];
      if (product) openProduct(product.id);
    });
    $('#customiseCta').addEventListener('click', () => {
      const product = state.products.find((p) => p.id === 'india-home') || state.products[0];
      if (product) openProduct(product.id);
    });

    wireStage();

    // product modal
    $('#pmClose').addEventListener('click', () => closeModal('#productModal'));
    $('#productModal').addEventListener('click', (event) => {
      if (event.target.id === 'productModal') closeModal('#productModal');
    });

    $('#pmVariants').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-variant]');
      if (!btn) return;
      state.active.variant = btn.dataset.variant;
      bumpAffinity(state.active.product, state.active.variant);
      renderProductModal();
    });

    $('#pmSizes').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-size]');
      if (!btn) return;
      state.active.size = btn.dataset.size;
      renderProductModal();
    });

    $('#pmName').addEventListener('input', (event) => {
      const cleaned = event.target.value.replace(/[^A-Za-z .'-]/g, '').slice(0, 16);
      state.active.printName = cleaned;
      event.target.value = cleaned;
      updatePreview();
    });

    $('#pmNumber').addEventListener('input', (event) => {
      const cleaned = event.target.value.replace(/\D/g, '').slice(0, 2);
      state.active.printNumber = cleaned;
      event.target.value = cleaned;
      updatePreview();
    });

    $('#pmNotes').addEventListener('input', (event) => {
      state.active.notes = event.target.value;
    });

    $('#pmQtyMinus').addEventListener('click', () => {
      state.active.qty = Math.max(1, state.active.qty - 1);
      $('#pmQty').textContent = String(state.active.qty);
    });
    $('#pmQtyPlus').addEventListener('click', () => {
      state.active.qty = Math.min(20, state.active.qty + 1);
      $('#pmQty').textContent = String(state.active.qty);
    });

    $('#pmFiles').addEventListener('change', (event) => {
      handleFiles(event.target.files);
      event.target.value = '';
    });

    $('#uploadList').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-unupload]');
      if (!btn) return;
      state.active.uploads.splice(Number(btn.dataset.unupload), 1);
      renderUploadList();
    });

    $('#pmAdd').addEventListener('click', addToCart);

    // checkout
    $('#checkoutBtn').addEventListener('click', openCheckout);
    $('#coClose').addEventListener('click', () => closeModal('#checkoutModal'));
    $('#checkoutModal').addEventListener('click', (event) => {
      if (event.target.id === 'checkoutModal') closeModal('#checkoutModal');
    });
    $('#checkoutForm').addEventListener('submit', submitOrder);
    $('#successDone').addEventListener('click', () => {
      closeModal('#checkoutModal');
      document.getElementById('collection').scrollIntoView({ behavior: 'smooth' });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!$('#productModal').hidden) closeModal('#productModal');
      if (!$('#checkoutModal').hidden) closeModal('#checkoutModal');
      if ($('#cartDrawer').classList.contains('open')) closeDrawer();
    });

    window.addEventListener('scroll', () => {
      $('#siteHeader').classList.toggle('scrolled', window.scrollY > 12);
    });
  }

  function persistCart() {
    writeJSON(
      CART_KEY,
      state.cart.map((item) => ({ ...item, uploads: (item.uploads || []).map((u) => ({ id: u.id, name: u.name })) }))
    );
    renderCart();
  }

  /* ---------------------------------------------------------------- boot */
  async function boot() {
    state.cart = loadCart();
    state.affinity = loadAffinity();
    $('#year').textContent = String(new Date().getFullYear());
    wire();
    renderCart();

    try {
      const [catalogue, config] = await Promise.all([api('/api/products'), api('/api/config')]);
      state.products = catalogue.products || [];
      state.pricing = { ...state.pricing, ...(config.pricing || {}) };
      renderHero();
      renderTeams();
      renderGrid();
      renderPicks();
      renderShowcase();
      renderCart();
    } catch (err) {
      $('#productGrid').innerHTML = '';
      $('#emptyState').hidden = false;
      $('#emptyState').textContent = 'We could not load the collection just now. Please refresh the page.';
      toast(err.message || 'Could not load the store.', 'err');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
