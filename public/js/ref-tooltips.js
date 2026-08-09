/**
 * ref-tooltips.js
 * Weapon-ref and wargear-ref hover tooltips for dynamically injected HTML.
 *
 * Used by the List Builder right panel to attach tooltips to
 * span.weapon-ref[data-weapon] and span.wargear-ref[data-wargear] elements
 * that appear inside injected unit profile content.
 *
 * Public API: window.AH_REF
 *   .initWeaponRefs(rootEl, weaponsArray)  — attach weapon tooltips
 *   .initWargearRefs(rootEl, wargearList)  — attach wargear tooltips (name + pts only)
 */

(function () {
  'use strict';

  // ── Slug helper (must match convert_factions.py output for data-weapon values) ──

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function _escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Tooltip positioning ────────────────────────────────────────────────────────

  function positionRefTooltip(tipEl, clientX, clientY) {
    var pad  = 14;
    var vpW  = window.innerWidth;
    var vpH  = window.innerHeight;
    var tipW = tipEl.offsetWidth  || 340;
    var tipH = tipEl.offsetHeight || 120;

    var x = clientX + pad;
    var y = clientY - tipH - pad;
    if (x + tipW > vpW - 8) x = clientX - tipW - pad;
    if (y < 8) y = clientY + pad;
    x = Math.max(8, Math.min(x, vpW - tipW - 8));
    y = Math.max(8, Math.min(y, vpH - tipH - 8));

    tipEl.style.left = x + 'px';
    tipEl.style.top  = y + 'px';
  }

  function attachRefTooltip(el, buildFn) {
    var tipEl = null;

    el.addEventListener('mouseenter', function (e) {
      tipEl = buildFn();
      tipEl.style.position   = 'fixed';
      tipEl.style.zIndex     = '10000';
      tipEl.style.opacity    = '0';
      tipEl.style.transition = 'opacity 0.1s ease';
      document.body.appendChild(tipEl);
      positionRefTooltip(tipEl, e.clientX, e.clientY);
      tipEl.style.opacity = '1';
    });

    el.addEventListener('mousemove', function (e) {
      if (tipEl) positionRefTooltip(tipEl, e.clientX, e.clientY);
    });

    el.addEventListener('mouseleave', function () {
      if (tipEl) { tipEl.remove(); tipEl = null; }
    });
  }

  // ── Weapon tooltip builder ─────────────────────────────────────────────────────

  /**
   * @param {Object} weapon   — weapon object from units JSON
   * @param {Array}  variants — resolved variants to show, in display order. Each is
   *                            { mods: [slug], count: n|null, of: n|null }. A weapon
   *                            whose upgrade covers only some of its instances (e.g.
   *                            2 of 3 Boltguns bought as Relic Weapons) passes two:
   *                            the untouched ones and the upgraded ones.
   * @param {Object} registry — weapon-modifier registry, or null for no modifiers
   */
  function buildWeaponTooltip(weapon, variants, registry) {
    var tip = document.createElement('div');
    tip.className = 'ah-ref-tooltip ah-ref-tooltip--weapon';

    var header = document.createElement('div');
    header.className = 'ah-ref-tooltip__header';
    header.innerHTML =
      '<span class="ah-ref-tooltip__type">WEAPON</span>' +
      '<span class="ah-ref-tooltip__name">' + _escHtml(weapon.name || '') + '</span>';
    tip.appendChild(header);

    var list = (variants && variants.length) ? variants : [{ mods: [], count: null, of: null }];
    var resolver = (window.AH_WMOD && registry) ? window.AH_WMOD : null;

    // Every modifier in play, in order of first appearance — the chip strip describes
    // the weapon as a whole, so a partial upgrade still names what can apply to it.
    var allMods = [];
    list.forEach(function (v) {
      (v.mods || []).forEach(function (m) { if (allMods.indexOf(m) === -1) allMods.push(m); });
    });
    if (resolver && allMods.length) {
      var chips = document.createElement('div');
      chips.className = 'ah-ref-tooltip__mods';
      allMods.forEach(function (slug) {
        var item = registry[slug];
        if (!item) return;
        var chip = document.createElement('span');
        chip.className = 'ah-ref-tooltip__mod';
        chip.textContent = item.name;
        chips.appendChild(chip);
      });
      if (chips.childNodes.length) tip.appendChild(chips);
    }

    var multi = list.length > 1;
    list.forEach(function (v) {
      var resolved = resolver
        ? resolver.resolve(weapon, v.mods || [], registry)
        : { points: weapon.points, profiles: null };

      var block = document.createElement('div');
      block.className = 'ah-ref-tooltip__variant' + (multi ? ' ah-ref-tooltip__variant--split' : '');

      // Only label the blocks when there is more than one to tell apart.
      if (multi) {
        var label = document.createElement('div');
        label.className = 'ah-ref-tooltip__variant-label';
        var names = (v.mods || []).map(function (m) { return (registry[m] || {}).name || m; });
        var count = (v.count != null && v.of != null) ? v.count + ' of ' + v.of : null;
        label.innerHTML =
          (count ? '<span class="ah-ref-tooltip__variant-count">' + _escHtml(count) + '</span>' : '') +
          '<span>' + _escHtml(names.length ? names.join(' + ') : 'Unmodified') + '</span>';
        block.appendChild(label);
      }

      var profs = resolved.profiles || _fallbackProfiles(weapon);
      profs.forEach(function (profile) {
        if (profile.profileName) {
          var nameEl = document.createElement('div');
          nameEl.className = 'ah-ref-tooltip__profile-name';
          nameEl.textContent = profile.profileName;
          block.appendChild(nameEl);
        }
        block.appendChild(_buildStatRow(profile, profile.changed || {}));
        if (profile.keywords && profile.keywords.length > 0) {
          block.appendChild(_buildKeywordEl(profile.keywords));
        }
      });

      if (resolved.points != null) {
        var pts = document.createElement('div');
        pts.className = 'ah-ref-tooltip__points';
        pts.innerHTML = resolved.points + ' <span>pts</span>';
        block.appendChild(pts);
      }
      tip.appendChild(block);
    });

    if (weapon.availability) {
      var avail = document.createElement('div');
      avail.className = 'ah-ref-tooltip__availability';
      avail.innerHTML = '<span class="ah-ref-tooltip__avail-label">Available To</span> ' +
        _escHtml(weapon.availability);
      tip.appendChild(avail);
    }

    return tip;
  }

  // Shape an unresolved weapon like the resolver's output, so one render path serves
  // both (no modifiers in play, or weapon-mods.js not loaded).
  function _fallbackProfiles(weapon) {
    if (weapon.profiles && weapon.profiles.length) {
      return weapon.profiles.map(function (p) {
        var merged = Object.assign({}, weapon, p);
        merged.changed = {};
        return merged;
      });
    }
    return [{
      profileName: null, range: weapon.range, attacks: weapon.attacks,
      strength: weapon.strength, ap: weapon.ap, damage: weapon.damage,
      keywords: weapon.keywords || [], changed: {},
    }];
  }

  function _buildStatRow(src, changed) {
    var row = document.createElement('div');
    row.className = 'ah-ref-tooltip__stat-row';
    var keys = ['Range', 'A', 'S', 'AP', 'D'];
    var vals = [src.range, src.attacks, src.strength, src.ap, src.damage];
    keys.forEach(function (k, i) {
      var cell = document.createElement('div');
      cell.className = 'ah-ref-tooltip__stat-cell';
      var mod = changed && changed[k] ? ' ah-ref-tooltip__stat-value--mod' : '';
      cell.innerHTML =
        '<span class="ah-ref-tooltip__stat-label">' + k + '</span>' +
        '<span class="ah-ref-tooltip__stat-value' + mod + '">' +
          _escHtml(vals[i] != null ? vals[i] : '—') + '</span>';
      row.appendChild(cell);
    });
    return row;
  }

  function _buildKeywordEl(keywords) {
    var kw = document.createElement('div');
    kw.className = 'ah-ref-tooltip__keywords';
    kw.textContent = keywords.join(', ');
    return kw;
  }

  // ── Wargear tooltip builder (name + points; no body text in list builder) ───────

  function buildWargearTooltip(name, points, bodyHtml) {
    var tip = document.createElement('div');
    tip.className = 'ah-ref-tooltip ah-ref-tooltip--wargear';

    var header = document.createElement('div');
    header.className = 'ah-ref-tooltip__header';
    header.innerHTML =
      '<span class="ah-ref-tooltip__type">WARGEAR</span>' +
      '<span class="ah-ref-tooltip__name">' + name + '</span>' +
      (points ? '<span class="ah-ref-tooltip__points-inline">' + points + '</span>' : '');
    tip.appendChild(header);

    if (bodyHtml) {
      var body = document.createElement('div');
      body.className = 'ah-ref-tooltip__body';
      body.innerHTML = bodyHtml;
      tip.appendChild(body);
    }

    return tip;
  }

  // ── Public init functions ──────────────────────────────────────────────────────

  // ── Modifier discovery ─────────────────────────────────────────────────────────

  /**
   * Modifiers that apply to a weapon-ref, read from an explicit `data-mods` attribute
   * when the caller knows them (the List Builder does — see refSpan in
   * list-builder-ui.js), otherwise inferred from the DOM.
   *
   * Inference walks backwards over immediately-adjacent wargear-refs, e.g.
   *   1x <span wargear-ref="twin-linked">Twin-Linked</span> <span weapon-ref>Boltgun</span>
   * Adjacency is strict: any real text between the two ends the walk, so prose like
   * "…upgraded to be a Relic Weapon. This upgrade is applied to both the Boltgun…"
   * is not misread as a modified Boltgun.
   */
  function _modsFor(el, registry) {
    if (el.dataset.mods != null) {
      return el.dataset.mods.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    if (!registry || !window.AH_WMOD) return [];
    var mods = [], node = el.previousSibling;
    while (node) {
      if (node.nodeType === 3) {                       // text node
        if (/\S/.test(node.nodeValue || '')) break;    // real prose → stop
        node = node.previousSibling;
        continue;
      }
      if (node.nodeType !== 1) { node = node.previousSibling; continue; }
      var slug = (node.classList && node.classList.contains('wargear-ref'))
        ? node.getAttribute('data-wargear') : null;
      if (!slug || !window.AH_WMOD.isModifier(slug, registry)) break;
      mods.unshift(slug);
      node = node.previousSibling;
    }
    return mods;
  }

  // Variants to render for one weapon-ref. `data-opt-mods` marks an optional upgrade
  // that may cover only some instances (data-opt-applied of data-opt-total); when it
  // is partial, the untouched instances get their own block so both statlines show.
  function _variantsFor(el, registry) {
    var mods = _modsFor(el, registry);
    var opt  = (el.dataset.optMods || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!opt.length) return [{ mods: mods, count: null, of: null }];

    var applied = parseInt(el.dataset.optApplied || '0', 10) || 0;
    var total   = parseInt(el.dataset.optTotal || '0', 10) || 0;
    if (!applied) return [{ mods: mods, count: null, of: null }];
    if (!total || applied >= total) return [{ mods: mods.concat(opt), count: null, of: null }];
    return [
      { mods: mods,             count: total - applied, of: total },
      { mods: mods.concat(opt), count: applied,         of: total },
    ];
  }

  /**
   * Attach weapon-ref hover tooltips to all span.weapon-ref[data-weapon] inside rootEl.
   * @param {Element|Document} rootEl      — container to search within
   * @param {Array}            weapons     — array of weapon objects from units JSON
   * @param {Array}            wargearList — faction wargear items, for modifier resolution
   */
  function initWeaponRefs(rootEl, weapons, wargearList) {
    if (!weapons || !weapons.length) return;
    var root = rootEl || document;

    var lookup = {};
    weapons.forEach(function (w) {
      lookup[slugify(w.name)] = w;
    });
    var registry = (window.AH_WMOD && wargearList)
      ? window.AH_WMOD.buildRegistry(wargearList) : null;

    root.querySelectorAll('span.weapon-ref[data-weapon]').forEach(function (el) {
      var weapon = lookup[el.dataset.weapon];
      if (!weapon) return;
      // Resolved lazily on hover: the List Builder mutates data-opt-applied in place
      // as relic counts change, without re-attaching handlers.
      attachRefTooltip(el, function () {
        return buildWeaponTooltip(weapon, _variantsFor(el, registry), registry);
      });
    });
  }

  /**
   * Attach wargear-ref hover tooltips to all span.wargear-ref[data-wargear] inside rootEl.
   * @param {Element|Document} rootEl      — container to search within
   * @param {Array}            wargearList — array of {name, pointsCost?} objects
   */
  function initWargearRefs(rootEl, wargearList) {
    if (!wargearList || !wargearList.length) return;
    var root = rootEl || document;

    var lookup = {};
    wargearList.forEach(function (item) {
      if (item && item.name) lookup[slugify(item.name)] = item;
    });

    root.querySelectorAll('span.wargear-ref[data-wargear]').forEach(function (el) {
      var entry = lookup[el.dataset.wargear];
      if (!entry) return;
      var pts = entry.pointsCost != null ? entry.pointsCost + ' pts' : '';
      // effectsHtml is the authored prose as written — paragraphs, bullet lists and the
      // keyword/weapon/wargear spans — so the tooltip reads exactly as the faction page
      // does. effects[] is the flattened fallback for data predating that field, where
      // bullets are the best guess available.
      var body = entry.effectsHtml || '';
      if (!body && (entry.effects || []).length) {
        body = '<ul class="ah-ref-tooltip__fx">' + entry.effects.map(function (e) {
          return '<li>' + _escHtml(e) + '</li>'; }).join('') + '</ul>';
      }
      attachRefTooltip(el, function () { return buildWargearTooltip(entry.name, pts, body); });
    });
  }

  // ── Export ─────────────────────────────────────────────────────────────────────

  // Remove any tooltip nodes still attached to <body> (e.g. orphaned when their
  // host element is removed during a re-render). Call before rebuilding content.
  function clearTooltips() {
    var nodes = document.querySelectorAll('.ah-ref-tooltip');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  // Mobile / tap-away: dismiss any visible tooltip when tapping elsewhere.
  document.addEventListener('pointerdown', function (e) {
    if (!e.target.closest('.weapon-ref, .wargear-ref, .keyword')) clearTooltips();
  }, true);

  window.AH_REF = {
    initWeaponRefs:  initWeaponRefs,
    initWargearRefs: initWargearRefs,
    clearTooltips:   clearTooltips,
    // Primitives, for callers that build their own lookup but want the shared
    // positioning/hover behaviour — the faction profile pages scrape wargear bodies
    // out of the rendered DOM, which is richer than the JSON `effects` list.
    attachRefTooltip:    attachRefTooltip,
    buildWargearTooltip: buildWargearTooltip,
  };

})();
