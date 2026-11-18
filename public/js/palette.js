/* Palette switcher for the Fancy Raccoon storefront. */
(function () {
  'use strict';

  var KEY = 'fr:palette:v1';

  /* Colours only — never surfaced as text in the UI. */
  var PALETTES = [
    { id: 'roast', paper: '#F5ECDC', chips: ['#0F3B36', '#F5ECDC', '#F2600F'] },
    { id: 'glacier', paper: '#EEF4FA', chips: ['#8ECBF0', '#14294D', '#F4E733'] },
    { id: 'orchid', paper: '#F7F2E9', chips: ['#F7F2E9', '#17161A', '#E53F9B'] },
    { id: 'volta', paper: '#F3F1EC', chips: ['#1D1D1F', '#D8CBB3', '#1F63FF'] }
  ];

  var byId = {};
  PALETTES.forEach(function (p) { byId[p.id] = p; });

  function stored() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw && byId[raw] ? raw : null;
    } catch (err) {
      return null;
    }
  }

  function current() {
    var attr = document.documentElement.getAttribute('data-palette');
    return byId[attr] ? attr : 'roast';
  }

  function apply(id, remember) {
    var palette = byId[id];
    if (!palette) return;
    document.documentElement.setAttribute('data-palette', id);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', palette.paper);
    if (remember) {
      try { localStorage.setItem(KEY, id); } catch (err) { /* storage may be blocked */ }
    }
    Array.prototype.forEach.call(document.querySelectorAll('.palette-option'), function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-palette') === id ? 'true' : 'false');
    });
  }

  function buildDock() {
    var dock = document.getElementById('paletteDock');
    var list = document.getElementById('paletteList');
    if (!dock || !list) return;

    var toggle = document.getElementById('paletteToggle');
    var dots = document.createElement('span');
    dots.className = 'pd-dots';
    for (var d = 0; d < 3; d++) {
      var dot = document.createElement('span');
      dot.className = 'pd-dot';
      dots.appendChild(dot);
    }
    toggle.insertBefore(dots, toggle.firstChild);

    list.innerHTML = PALETTES.map(function (p, i) {
      var chips = p.chips.map(function (hex) {
        return '<i style="background:' + hex + '"></i>';
      }).join('');
      return '<button class="palette-option" type="button" data-palette="' + p.id +
        '" aria-pressed="false" aria-label="Colour set ' + (i + 1) + '">' +
        '<span class="palette-chips">' + chips + '</span>' +
        '</button>';
    }).join('');

    list.addEventListener('click', function (event) {
      var btn = event.target.closest('.palette-option');
      if (!btn) return;
      apply(btn.getAttribute('data-palette'), true);
    });

    toggle.addEventListener('click', function () {
      var open = dock.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', function (event) {
      if (!dock.contains(event.target)) {
        dock.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        dock.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function init() {
    if (!document.getElementById('paletteDock')) return;
    buildDock();
    apply(stored() || current(), false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
