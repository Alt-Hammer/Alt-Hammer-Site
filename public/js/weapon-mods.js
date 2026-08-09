/**
 * weapon-mods.js
 * Resolves a weapon's statline, keywords and points after weapon-domain wargear
 * modifiers are applied — e.g. a Twin-linked Heavy Bolter, or a Boltgun upgraded
 * with Relic Weapon. Modifiers stack (a Twin-linked Accursed Heavy Bolter carries
 * two), and the same rules drive the List Builder and the faction profile pages.
 *
 * The effects come entirely from each faction-wargear item's `mechanics.rows[]`
 * (see scripts/convert_faction_wargear.py): rows targeting `domain: "weapon"`
 * carry `weaponStats` deltas, `keywords` add/remove and a `points` op. A new
 * weapon modifier therefore needs source data only — no code here.
 *
 * Resolve order is NOT the order the modifiers appear in a weapon's name.
 * Proportional-cost modifiers (those priced with `points.op: "mult"` — today only
 * Twin-linked) resolve LAST, so their tier is chosen against the weapon's
 * *effective* Strength and their surcharge compounds on the already-upgraded cost.
 * scripts/convert_options.py applies the identical rule at build time, so the
 * points shown here always match the points the option row charges.
 *
 * Public API: window.AH_WMOD
 *   .buildRegistry(wargearItems) — slug → item, weapon-domain modifiers only
 *   .resolve(weapon, modSlugs, registry) — resolved profiles + keywords + points
 *   .isModifier(slug, registry)
 */

(function () {
  'use strict';

  // char → weapon field. `Range` is carried so a modifier could extend it.
  var CHARS = { Range: 'range', A: 'attacks', S: 'strength', AP: 'ap', D: 'damage' };

  // ── Value arithmetic ───────────────────────────────────────────────────────────
  // Weapon characteristics come in three shapes and each takes a delta differently:
  //   "3", "-1", "36\""  → plain number, any suffix preserved  (36" +1 → 37")
  //   "S", "S +3"        → model-relative melee Strength; the offset moves (S+3 → S+4)
  //   "D6", "D3+1"       → dice expression; a trailing offset is added (D6 → D6+1)
  // Anything unrecognised is returned untouched rather than mangled.
  function _applyDelta(baseVal, eff, char) {
    if (eff.op === 'set') return String(eff.value);
    var raw = String(baseVal == null ? '' : baseVal).trim();
    if (!raw) return baseVal;

    // AP is stored signed ("-1"), so a modifier that *improves* AP must move it
    // further negative. `inc` therefore means "better AP", not "larger number".
    var delta = (eff.op === 'inc' ? 1 : -1) * (eff.value || 0);
    if (char === 'AP') delta = -delta;

    var m = raw.match(/^(-?\d+)(.*)$/);              // plain number (+ optional suffix)
    if (m) return String(parseInt(m[1], 10) + delta) + (m[2] || '');

    var rel = raw.match(/^(.*?)([+-]\s*\d+)$/);      // trailing signed offset ("S +3", "D6+1")
    if (rel) {
      var n = parseInt(rel[2].replace(/\s+/g, ''), 10) + delta;
      var head = rel[1].trim();
      return n === 0 ? head : head + (n > 0 ? '+' : '') + n;
    }
    if (/^[A-Za-z]|^\d*[Dd]\d+$/.test(raw)) {        // bare "S" / "D6" → gains an offset
      return delta === 0 ? raw : raw + (delta > 0 ? '+' : '') + delta;
    }
    return baseVal;
  }

  function _numericStrength(val) {
    var m = String(val == null ? '' : val).trim().match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : null;            // "S +3" → null (needs a wielder)
  }

  // Highest Strength across a weapon's profiles — the value the points tier is
  // chosen against, matching _max_strength in scripts/convert_options.py.
  function _maxStrength(w) {
    var vals = [];
    if (w.strength != null) vals.push(_numericStrength(w.strength));
    (w.profiles || []).forEach(function (p) {
      if (p.strength != null) vals.push(_numericStrength(p.strength));
    });
    vals = vals.filter(function (v) { return v != null; });
    return vals.length ? Math.max.apply(null, vals) : null;
  }

  // ── Row selection ──────────────────────────────────────────────────────────────
  function _hasKeyword(list, kw) {
    var t = String(kw).toLowerCase();
    return (list || []).some(function (k) { return String(k).toLowerCase().indexOf(t) === 0; });
  }

  function _filterMatches(filt, view) {
    if (!filt) return true;
    var values = filt.values || [];
    if (filt.kind === 'weaponClass') {
      var section = String(view.section || '').toLowerCase();
      return values.some(function (v) { return section.indexOf(String(v).toLowerCase()) !== -1; });
    }
    if (filt.kind === 'weaponKeyword') {
      return values.some(function (v) { return _hasKeyword(view.keywords, v); });
    }
    if (filt.kind === 'weaponStat') {
      return values.every(function (cond) {
        var cur = cond.char === 'S' ? view.strengthNum : null;
        if (cur == null) return false;               // model-relative S can't be tiered
        if (cond.cmp === '<')  return cur <  cond.value;
        if (cond.cmp === '<=') return cur <= cond.value;
        if (cond.cmp === '>')  return cur >  cond.value;
        if (cond.cmp === '>=') return cur >= cond.value;
        if (cond.cmp === '=')  return cur === cond.value;
        return false;
      });
    }
    return false;
  }

  // Most specific matching row wins, NOT the first one listed. Twin-linked declares
  // three rows — S<9, S>=9, and Torrent — and a Torrent flamer with S5 matches both
  // the S<9 row (A+1) and the Torrent row (A+3); the Torrent row is the intended one.
  var _SPECIFICITY = { weaponKeyword: 3, weaponStat: 2, weaponClass: 1 };
  function _pickRowStrict(rows, view) {
    var best = null, bestRank = -1;
    (rows || []).forEach(function (row) {
      var target = row.target || {};
      if (target.domain !== 'weapon') return;
      if (!_filterMatches(target.filter, view)) return;
      var rank = target.filter ? (_SPECIFICITY[target.filter.kind] || 0) : 0;
      if (rank > bestRank) { best = row; bestRank = rank; }
    });
    return best;
  }

  // Melee weapons carry model-relative Strength ('S', 'S +3'), which can't satisfy a
  // Strength-tiered filter without a wielder. Fall back to tiering as if S=0 — the
  // lowest tier — which is how these weapons have always been priced (the converter's
  // int() parse fell through to 0). flat_modifier_apply in scripts/convert_options.py
  // does the same, so the two stay in step.
  function _pickRow(rows, view) {
    var row = _pickRowStrict(rows, view);
    if (!row && view.strengthNum == null) {
      row = _pickRowStrict(rows, Object.assign({}, view, { strengthNum: 0 }));
    }
    return row;
  }

  // ── Registry ───────────────────────────────────────────────────────────────────
  function _weaponRows(item) {
    return (((item || {}).mechanics || {}).rows || []).filter(function (r) {
      return (r.target || {}).domain === 'weapon';
    });
  }

  /** slug → wargear item, for every item that modifies weapons. */
  function buildRegistry(wargearItems) {
    var reg = {};
    (wargearItems || []).forEach(function (it) {
      if (it && it.itemId && _weaponRows(it).length) reg[it.itemId] = it;
    });
    return reg;
  }

  function isModifier(slug, registry) {
    return !!(registry && Object.prototype.hasOwnProperty.call(registry, slug));
  }

  // A modifier whose cost scales with the weapon it upgrades (points.op "mult").
  // These resolve last — see the file header.
  function _isProportional(item) {
    return _weaponRows(item).some(function (r) { return (r.points || {}).op === 'mult'; });
  }

  // ── Resolve ────────────────────────────────────────────────────────────────────
  function _blankProfile(w, name) {
    return {
      profileName: name || null,
      range: w.range, attacks: w.attacks, strength: w.strength, ap: w.ap, damage: w.damage,
      keywords: (w.keywords || []).slice(),
      changed: {},
    };
  }

  function _kwAddRemove(kw, k) {
    (k.remove || []).forEach(function (r) {
      kw = kw.filter(function (x) { return String(x).toLowerCase() !== String(r).toLowerCase(); });
    });
    (k.add || []).forEach(function (a) {
      if (!kw.some(function (x) { return String(x).toLowerCase() === String(a).toLowerCase(); })) kw.push(a);
    });
    return kw;
  }

  /**
   * @param {Object} weapon    — weapon object from units JSON
   * @param {Array}  modSlugs  — modifier slugs in *name* order (display order)
   * @param {Object} registry  — from buildRegistry()
   * @returns {{applied:Array, points:(number|null), profiles:Array}}
   */
  function resolve(weapon, modSlugs, registry) {
    var profiles = (weapon.profiles && weapon.profiles.length)
      ? weapon.profiles.map(function (p) {
          var merged = Object.assign({}, weapon, p);
          return _blankProfile(merged, p.profileName);
        })
      : [_blankProfile(weapon, null)];

    var items = (modSlugs || [])
      .map(function (s) { return registry && registry[s]; })
      .filter(Boolean);

    // Flat modifiers first, proportional ones (Twin-linked) last.
    var ordered = items.filter(function (i) { return !_isProportional(i); })
             .concat(items.filter(_isProportional));

    var points = weapon.points != null ? weapon.points : null;
    var pointsS = _maxStrength(weapon);   // tier is chosen on the weapon, not per profile

    ordered.forEach(function (item) {
      // Stats & keywords resolve per profile; a multi-profile weapon can match a
      // different row per profile (e.g. a Strength-filtered row).
      profiles.forEach(function (prof) {
        var row = _pickRow(_weaponRows(item), {
          section: weapon.section,
          keywords: prof.keywords,
          strengthNum: _numericStrength(prof.strength),
        });
        if (!row) return;
        (row.weaponStats || []).forEach(function (eff) {
          var field = CHARS[eff.char];
          if (!field || prof[field] == null) return;
          var next = _applyDelta(prof[field], eff, eff.char);
          if (String(next) !== String(prof[field])) prof.changed[eff.char] = true;
          prof[field] = next;
        });
        prof.keywords = _kwAddRemove(prof.keywords, row.keywords || {});
      });

      // Points resolve once for the weapon, against its max Strength — the same
      // basis convert_options.py bakes into the option rows.
      var pRow = _pickRow(_weaponRows(item), {
        section: weapon.section,
        keywords: (weapon.keywords || []),
        strengthNum: pointsS,
      });
      var p = pRow && pRow.points;
      if (points != null && p) {
        if (p.op === 'delta') points = points + (p.value || 0);
        else if (p.op === 'mult') points = Math.ceil(points * (p.value || 1));
        else if (p.op === 'set') points = p.value;
      } else if (points != null && !pRow && item.pointsCost != null) {
        points = points + item.pointsCost;
      }
      // Strength may have moved, re-tiering any later proportional modifier.
      if (pointsS != null && pRow) {
        (pRow.weaponStats || []).forEach(function (eff) {
          if (eff.char !== 'S') return;
          pointsS = eff.op === 'set' ? eff.value
                  : pointsS + (eff.op === 'inc' ? (eff.value || 0) : -(eff.value || 0));
        });
      }
    });

    return {
      applied: ordered.length
        ? (modSlugs || []).map(function (s) { return registry && registry[s]; }).filter(Boolean)
            .map(function (i) { return { slug: i.itemId, name: i.name }; })
        : [],
      points: points,
      profiles: profiles,
    };
  }

  window.AH_WMOD = {
    buildRegistry: buildRegistry,
    isModifier: isModifier,
    resolve: resolve,
  };

})();
