/**
 * list-builder.js — Alt-Hammer List Builder engine (v5, per-model loadout model)
 *
 * Consumes the canonical unit record produced by scripts/convert_options.py:
 *   unit.options = { forceOrg, composition, slots, sections:[{key,prose,clauses[]}] }
 *
 * Core model
 * ----------
 * A unit instance tracks a per-model-type count (composition) and, for each
 * option clause, a selection map { optionRef: count }. "count" is the number of
 * models (or instances) taking that option.
 *
 * Slot pools: clauses that fill the same equipment slot (the compulsory Standard
 * Wargear "choose" plus any "replace" clauses targeting that slot) share one pool
 * of size = model count. Allocating a model to a replace option therefore frees a
 * slot from the standard choose — so points are simply the sum of every equipped
 * option (no replace-subtraction bookkeeping, no double counting).
 *
 * Public API on window.LB. list-builder-ui.js depends on this file.
 */
(function () {
  'use strict';

  var SESSION_KEY = 'ah-list-builder-v6';   // v6: per-model sub-selection state
  var _nextId = 1;
  var _state = _defaultState();
  var _data = { factions: [], units: null, factionWargear: null, detachmentTraits: null, upgradeCatalog: null };

  function _defaultState() {
    // detachmentTraitChoices: { traitId: { choiceId: [optionId, …] } } — the picks a
    // trait demands of the player (Aspect Host: which Aspect Warriors unit becomes
    // Battleline). Absent until chosen, which is what makes the list invalid.
    return { listName: '', faction: null, targetPoints: 1000, detachmentTraitsSelected: [],
             detachmentTraitChoices: {}, selectedUnits: [], selectedUnitId: null };
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  function loadFactionList() {
    var el = document.getElementById('lb-factions-data');
    if (!el) return;
    try { _data.factions = JSON.parse(el.textContent); }
    catch (e) { console.error('[LB] faction list parse failed', e); }
  }

  function _fetchJson(path) {
    return fetch(path).then(function (r) { return r.ok ? r.json() : null; })
                      .catch(function () { return null; });
  }

  function loadFaction(slug) {
    if (!slug) return Promise.resolve();
    return Promise.all([
      _fetchJson('/data/units/' + slug + '.json'),
      _fetchJson('/data/faction-wargear/' + slug + '.json'),
      _fetchJson('/data/detachment-traits/' + slug + '.json'),
      _fetchJson('/data/upgrade-catalogs/' + slug + '.json'),
    ]).then(function (res) {
      _data.units = res[0];
      _data.factionWargear = res[1];
      _data.detachmentTraits = res[2];
      _data.upgradeCatalog = res[3];   // selectable upgrade catalogs (e.g. Gifts of Chaos); null if none
    });
  }

  // ── Lookups ────────────────────────────────────────────────────────────────
  function getUnitData(name) {
    if (!_data.units) return null;
    var list = _data.units.units || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  function unitOptions(u) { return (u && u.options) || {}; }
  function modelTypes(u) {
    var c = unitOptions(u).composition || {};
    return c.modelTypes || [{ name: u ? u.name : '', stats: u ? u.stats : {}, basePoints: (u && u.stats && u.stats.basePoints) || 0 }];
  }
  // Every clause the unit can present. A `keyCharacteristic` section contributes only the
  // clauses of the profile(s) currently SELECTED — that single filter is what makes
  // pricing, caps, slot pools, availability and every clamp work on key characteristics
  // with no further changes, since they all iterate this one function.
  //
  // `entry` is optional and its absence means "all profiles": id lookups (findClause,
  // relicModifier) must still resolve a clause that belongs to a profile the player has
  // since switched away from, so the clamps can find and clear it.
  function clauses(u, entry) {
    var out = [];
    (unitOptions(u).sections || []).forEach(function (s) {
      if (s.key === SEC_KEYCHAR) {
        (s.profiles || []).forEach(function (pr) {
          if (entry && !keyCharSelected(entry, s.id, pr.id)) return;
          (pr.clauses || []).forEach(function (cl) {
            cl.__section = s.key; cl.__keyChar = s.id; cl.__profile = pr.id; out.push(cl);
          });
        });
        return;
      }
      (s.clauses || []).forEach(function (cl) { cl.__section = s.key; out.push(cl); });
    });
    return out;
  }
  function findClause(u, clauseId) {
    var all = clauses(u);
    for (var i = 0; i < all.length; i++) if (all[i].id === clauseId) return all[i];
    return null;
  }
  function findOpt(cl, ref) {
    var os = cl.options || [];
    for (var i = 0; i < os.length; i++) if (os[i].ref === ref) return os[i];
    return null;
  }
  function totalModels(entry) {
    var n = 0, mc = entry.modelCounts || {};
    Object.keys(mc).forEach(function (k) { n += mc[k] || 0; });
    return Math.max(0, n);
  }
  // Effective model count a fixed (compulsory) clause applies to. A fixed clause scoped
  // to a named model/role ("Every Cultist is equipped with …") applies only to that model
  // type; an unscoped fixed clause ("Every model is equipped with …") applies to the unit.
  // The scoped name is matched to a model-count key tolerant of singular/plural, so a
  // docx subject ('Cultist'/'Legionary') binds a Unit-Data type name ('Cultists'/'Legionaries').
  function _singular(s) {
    s = String(s).toLowerCase();
    if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
    if (/s$/.test(s)) return s.slice(0, -1);
    return s;
  }
  function _fixedN(entry, cl) {
    var mt = cl && cl.scope && cl.scope.modelType, mc = entry.modelCounts || {};
    if (!mt) return totalModels(entry);
    if (mc[mt] != null) return mc[mt];
    var want = _singular(mt), keys = Object.keys(mc);
    for (var i = 0; i < keys.length; i++) if (_singular(keys[i]) === want) return mc[keys[i]];
    return 0;
  }

  // ── Slot helpers (choose + replace share a pool) ─────────────────────────────
  function slotOf(cl) {
    if (cl.slot) return cl.slot;
    if (cl.replaces && cl.replaces.slot) return cl.replaces.slot;
    return null;
  }
  function isSlotPooled(cl) {
    // Only per-model compulsory-style slot fills share the model pool: choose
    // (standard) and replace targeting a slot. Unit-scope ("The unit …") is a
    // single uniform selection, not a per-model distribution, so it is excluded.
    // Additive 'add' clauses (mounts/grenades) also do not pool.
    return slotOf(cl) && (cl.op === 'choose' || cl.op === 'replace') &&
           !(cl.scope && cl.scope.who === 'unit');
  }
  function clauseTotal(entry, clauseId) {
    var sel = entry.sel[clauseId] || {}, t = 0;
    Object.keys(sel).forEach(function (k) { if (k !== '__count') t += sel[k] || 0; });
    return t;
  }
  function slotUsed(entry, u, slot) {
    var t = 0;
    clauses(u, entry).forEach(function (cl) {
      if (isSlotPooled(cl) && slotOf(cl) === slot) t += clauseTotal(entry, cl.id);
    });
    return t;
  }
  // Normalise a model-type name for matching: lowercase, apostrophe/hyphen → space,
  // Guardsmen→Guardsman (irregular plural), and a trailing plural 's' dropped.
  function _normModelName(s) {
    return String(s == null ? '' : s).toLowerCase().trim()
      .replace(/[’'`\-]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/men$/, 'man').replace(/s$/, '');
  }
  // The current count of the composition model type a clause targets (scope.modelType),
  // or null when the clause isn't model-scoped (generic "model"/"unit", a role that isn't
  // its own model line, or a single-model-type unit → caller uses the total instead).
  function _scopedModelCount(entry, u, cl) {
    var mt = cl.scope && cl.scope.modelType;
    if (!mt) return null;
    var n = _normModelName(mt);
    if (!n || n === 'model' || n === 'unit') return null;
    var types = (unitOptions(u).composition || {}).modelTypes || [];
    if (types.length <= 1) return null;   // single type → count == totalModels; let caller use total
    for (var i = 0; i < types.length; i++)
      if (_normModelName(types[i].name) === n) return entry.modelCounts[types[i].name] || 0;
    return null;   // unresolved name → fall back to total (safe; name hygiene surfaces separately)
  }
  function clauseSubCap(entry, u, cl) {
    var N = totalModels(entry);
    if (cl.op === 'modifier' && cl.appliesTo) return equippedCount(entry, u, cl.appliesTo.weapon);
    var w = cl.scope || {};
    var Neff = _suppress(entry, u, cl, N);   // reduced by suppressed models (Paragon etc.)
    var scoped = _scopedModelCount(entry, u, cl);
    var eff = scoped != null ? _suppress(entry, u, cl, scoped) : Neff;   // bound by TARGETED type
    var base;
    // who:count = up to `count` eligible models, each taking up to pick.max selections.
    // (pick.max is 1 for the usual "N models each pick 1"; >1 for "the model … up to N".)
    if (w.who === 'count') base = Math.min(cl.scope.count || 1, eff) * ((cl.pick && cl.pick.max != null) ? cl.pick.max : 1);
    else if (w.who === 'ratio') { var r = cl.scope.ratio || {}; base = Math.min(Math.floor(Neff / (r.perX || 1)) * (r.n || 1), eff); }
    else if (w.who === 'unitPool') base = (cl.pick && cl.pick.max != null) ? cl.pick.max : 999; // finite unit-level pool (absolute, not × models)
    else if (w.who === 'unit') base = Neff <= 0 ? 0 : ((cl.pick && cl.pick.max != null) ? cl.pick.max : 999);
    else base = (cl.pick && cl.pick.max != null) ? cl.pick.max * eff : (eff > 0 ? Infinity : 0); // who:each total picks
    return Math.min(base, requiresCap(entry, u, cl)); // conditional (requires) cap
  }
  // Max a single option in a clause can reach, given pools/caps, then the automatic
  // kind rule: in a repeatable ("up to N", non-distinct) list a WARGEAR option is
  // once-each (≤1) while WEAPONS repeat up to the clause total. Weapons are unaffected.
  function optionCap(entry, u, cl, ref) {
    var o = findOpt(cl, ref);
    // A statline-banded item can't be taken by a model no band covers (see bandTakeable).
    if (o && !bandTakeable(entry, u, cl, o)) return 0;
    var cap = _rawOptionCap(entry, u, cl, ref);
    var pm = cl.pick && cl.pick.max;
    if (pm != null && pm > 1 && !(cl.pick && cl.pick.distinct)) {
      if (o && o.kind === 'wargear') cap = Math.min(cap, 1);
    }
    return cap;
  }
  function _rawOptionCap(entry, u, cl, ref) {
    var N = totalModels(entry);
    var cur = (entry.sel[cl.id] || {})[ref] || 0;
    if (cl.op === 'modifier' && cl.appliesTo) {
      var capE = clauseSubCap(entry, u, cl);             // = # of that weapon equipped
      return Math.max(0, cur + (capE - clauseTotal(entry, cl.id)));
    }
    if (cl.scope && cl.scope.who === 'unit') {
      // each option is an on/off toggle for the whole unit; total ≤ pick.max
      if (cur > 0) return 1;
      return clauseTotal(entry, cl.id) < clauseSubCap(entry, u, cl) ? 1 : 0;
    }
    if (cl.scope && cl.scope.who === 'unitPool') {
      // finite unit-level pool shared across the clause's options; count per item
      return Math.max(0, cur + (clauseSubCap(entry, u, cl) - clauseTotal(entry, cl.id)));
    }
    var subRemain = clauseSubCap(entry, u, cl) - (clauseTotal(entry, cl.id) - cur);
    if (isSlotPooled(cl)) {
      var slotRemain = N - (slotUsed(entry, u, slotOf(cl)) - cur);
      return Math.max(0, Math.min(subRemain, slotRemain));
    }
    if (cl.scope && cl.scope.who === 'each') {
      var sc = _scopedModelCount(entry, u, cl);
      var eff = _suppress(entry, u, cl, sc != null ? sc : N);   // per-option cap, less suppressed models
      var maxPer = (cl.pick && cl.pick.max != null) ? cl.pick.max : null;
      var clTot = clauseTotal(entry, cl.id);
      var totalCap = clauseSubCap(entry, u, cl);   // maxPer*eff (or ∞), capped by requires
      if (maxPer == null) return Math.max(0, Math.min(eff, cur + (totalCap - clTot))); // pick-any: ≤eff/option
      var remainTotal = cur + (totalCap - clTot);
      var perCap = (cl.pick && cl.pick.distinct) ? eff : (maxPer === 1 ? eff : totalCap);
      return Math.max(0, Math.min(remainTotal, perCap));
    }
    return Math.max(0, subRemain);
  }

  // ── Conditional (requires) gating + equipped-weapon counting (A3 / A4) ───────
  function _weaponKeywords(name) {
    var weapons = (_data.units && _data.units.weapons) || [];
    var n = String(name).trim().toLowerCase();
    for (var i = 0; i < weapons.length; i++)
      if ((weapons[i].name || '').trim().toLowerCase() === n)
        return (weapons[i].keywords || []).map(function (k) { return String(k).toLowerCase(); });
    return [];
  }
  function _slotMatchCount(entry, u, slot, matchFn) {
    var total = 0;
    clauses(u, entry).forEach(function (cl) {
      if (!(isSlotPooled(cl) && slotOf(cl) === slot)) return;
      var sel = entry.sel[cl.id] || {};
      Object.keys(sel).forEach(function (ref) {
        var o = findOpt(cl, ref); if (o && matchFn(o.name)) total += sel[ref] || 0;
      });
    });
    return total;
  }
  function _hasArmour(entry, u, armour) {
    var a = String(armour).toLowerCase(), found = false;
    clauses(u, entry).forEach(function (cl) {
      if (slotOf(cl) !== 'armour') return;
      var sel = entry.sel[cl.id] || {};
      Object.keys(sel).forEach(function (ref) {
        var o = findOpt(cl, ref); if (o && o.name.toLowerCase().indexOf(a) !== -1) found = true;
      });
    });
    return found;
  }
  // Max models eligible for a conditional clause (Infinity = unconstrained, 0 = blocked).
  function requiresCap(entry, u, cl) {
    var req = cl.scope && cl.scope.requires;
    if (!req || req.excludeKeyword) return Infinity;
    if (req.armour) return _hasArmour(entry, u, req.armour) ? Infinity : 0;
    if (req.weaponKeyword) {
      var kw = String(req.weaponKeyword).toLowerCase();
      return _slotMatchCount(entry, u, 'primary-ranged', function (nm) {
        return _weaponKeywords(nm).indexOf(kw) !== -1; });
    }
    if (req.weaponIn) {
      var set = req.weaponIn.map(function (w) { return String(w).toLowerCase(); });
      return _slotMatchCount(entry, u, 'primary-ranged', function (nm) {
        return set.indexOf(String(nm).toLowerCase()) !== -1; });
    }
    return Infinity;
  }
  // Net instances of a named weapon equipped across the unit (for "Each [weapon]…").
  // Counts fixed grants + options that add the weapon, minus models that replace it away.
  function equippedCount(entry, u, weaponName) {
    var target = String(weaponName).trim().toLowerCase(), total = 0, N = totalModels(entry);
    clauses(u, entry).forEach(function (cl) {
      if (cl.op === 'modifier') return;
      var sel = entry.sel[cl.id] || {};
      var unitScope = cl.scope && cl.scope.who === 'unit';
      (cl.options || []).forEach(function (o) {
        if ((o.name || '').trim().toLowerCase() !== target) return;
        var per = o.qty || 1;
        if (cl.op === 'fixed') { total += per * _fixedN(entry, cl); return; }   // always equipped
        var c = sel[o.ref] || 0; if (c) total += unitScope ? per * N : per * c;
      });
      if (cl.op === 'replace' && cl.replaces && !cl.replaces.slot) {
        var rn = cl.replaces.weapons || (cl.replaces.weapon ? [cl.replaces.weapon] : []);
        if (rn.some(function (w) { return String(w).trim().toLowerCase() === target; })) {
          var made = clauseTotal(entry, cl.id);
          if (made) total -= unitScope ? N : made;            // replaced away
        }
      }
    });
    return Math.max(0, total);
  }

  // ── Weapon availability by armour / mount (R2) ──────────────────────────────
  // Every weapon carries an `availability` list of armour/equipment tokens
  // (Tacticus, Gravis, Jump Pack, Bike, Terminator, …). A model may only take
  // weapons whose availability includes its *governing profile*: its armour
  // normally, or its mount (Jump Pack / Bike) when equipped — the Jump Pack and
  // Bike rules both state "can only be equipped with weapons that include
  // <mount>". Tokens compare case-insensitively with a trailing 's' stripped, so
  // the source's Scout/Scouts inconsistency unifies.
  var _availVocabCache = null, _availVocabFor = null;
  function _normTok(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/s$/, ''); }
  function _weaponByName(name) {
    var weapons = (_data.units && _data.units.weapons) || [];
    var n = String(name).trim().toLowerCase();
    for (var i = 0; i < weapons.length; i++)
      if ((weapons[i].name || '').trim().toLowerCase() === n) return weapons[i];
    return null;
  }
  function _availList(w) {
    if (!w) return [];
    var raw = w.availability;
    if (!raw && w.profiles) {            // fall back to profile availability if top-level is blank
      var seen = {}, out = [];
      w.profiles.forEach(function (p) {
        String(p.availability || '').split(',').forEach(function (t) {
          t = t.trim(); if (t && !seen[t]) { seen[t] = 1; out.push(t); }
        });
      });
      return out;
    }
    return String(raw || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  }
  function weaponAvailabilityList(name) { return _availList(_weaponByName(name)); }
  function _availVocab() {
    if (_availVocabFor === _data.units && _availVocabCache) return _availVocabCache;
    var set = {};
    ((_data.units && _data.units.weapons) || []).forEach(function (w) {
      _availList(w).forEach(function (t) { var n = _normTok(t); if (n && n !== 'all' && n !== 'vehicles only') set[n] = 1; });
    });
    _availVocabCache = set; _availVocabFor = _data.units; return set;
  }
  // The armour/equipment token embedded in an item name ("Gravis Armour" → gravi,
  // "Jump Pack" → jump pack). Matches a vocab token as a whole word (optional 's').
  function _vocabTokenFromName(name) {
    var vocab = _availVocab();
    var hay = ' ' + String(name || '').trim().toLowerCase() + ' ';
    var best = null;
    Object.keys(vocab).forEach(function (tok) {
      var re = new RegExp('(^|\\s)' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?(\\s|$)');
      if (re.test(hay) && (!best || tok.length > best.length)) best = tok;
    });
    return best;
  }
  // The model's current armour token: a selected armour-slot option overrides the
  // base armour (from the unit's keywords).
  function _armourToken(entry, u) {
    var selName = null;
    clauses(u, entry).forEach(function (cl) {
      if (slotOf(cl) !== 'armour') return;
      var sel = entry.sel[cl.id] || {};
      Object.keys(sel).forEach(function (ref) {
        if (sel[ref] > 0) { var o = findOpt(cl, ref); if (o) selName = o.name; }
      });
    });
    if (selName) return _vocabTokenFromName(selName);
    var vocab = _availVocab(), kws = u.keywords || [];
    for (var i = 0; i < kws.length; i++) { var t = _normTok(kws[i]); if (vocab[t]) return t; }
    return null;
  }
  function _entryHasVocabItem(entry, u, normTok) {
    var found = false;
    clauses(u, entry).forEach(function (cl) {
      var sel = entry.sel[cl.id] || {};
      Object.keys(sel).forEach(function (ref) {
        if (sel[ref] > 0) { var o = findOpt(cl, ref); if (o && _vocabTokenFromName(o.name) === normTok) found = true; }
      });
    });
    return found;
  }
  // Governing weapon-availability profile: a mount (Bike / Jump Pack) supersedes
  // the armour when equipped; otherwise the armour governs. null = no gating.
  function governingToken(entry, u) {
    if (_entryHasVocabItem(entry, u, 'bike')) return 'bike';
    if (_entryHasVocabItem(entry, u, 'jump pack')) return 'jump pack';
    return _armourToken(entry, u);
  }
  function weaponAvailable(name, token) {
    if (!token) return true;                        // no governing profile → no gating (e.g. vehicles)
    var list = _availList(_weaponByName(name));
    if (!list.length) return true;                  // no availability data → don't gate
    var norm = list.map(_normTok);
    return norm.indexOf('all') !== -1 || norm.indexOf(_normTok(token)) !== -1;
  }
  function optAvailable(entry, u, o) {
    if (!o || o.kind !== 'weapon') return true;
    return weaponAvailable(o.name, governingToken(entry, u));
  }
  // Clear weapon selections that the current armour/mount no longer permits.
  function _clampAvailability(e, u) {
    clauses(u, e).forEach(function (cl) {
      var sel = e.sel[cl.id]; if (!sel) return;
      Object.keys(sel).forEach(function (ref) {
        if (ref === '__count') return;
        var o = findOpt(cl, ref);
        if (o && o.kind === 'weapon' && !optAvailable(e, u, o)) delete sel[ref];
      });
      if (Object.keys(sel).length === 0) delete e.sel[cl.id];
    });
  }

  // ── Per-unit wargear cap groups (Unit Cap, from the upgrades workbook) ───────
  // An option's faction-wargear item may declare mechanics.unitCap = { group, cap }:
  // a unit may hold at most `cap` selections across every option in that named group
  // (e.g. armour-mount cap 1 → one mount/armour per unit). Options are matched by the
  // item their ref points at, so the group can span multiple clauses.
  function _optUnitCap(o) { var m = _optMechanics(o); return (m && m.unitCap) || null; }
  function _unitCapGroupUsed(entry, u, group) {
    var used = 0;
    clauses(u, entry).forEach(function (cl) {
      var sel = entry.sel[cl.id]; if (!sel) return;
      Object.keys(sel).forEach(function (ref) {
        if (ref === '__count' || !(sel[ref] > 0)) return;
        var uc = _optUnitCap(findOpt(cl, ref));
        if (uc && uc.group === group) used += sel[ref];
      });
    });
    return used;
  }
  // Room left in this option's group (Infinity when the option has no cap group).
  function unitCapRoom(entry, u, o) {
    var uc = _optUnitCap(o); if (!uc || uc.cap == null) return Infinity;
    return uc.cap - _unitCapGroupUsed(entry, u, uc.group);
  }
  function unitCapBlocked(entry, u, cl, ref, delta) {
    if (!(delta > 0)) return false;
    return unitCapRoom(entry, u, findOpt(cl, ref)) <= 0;
  }
  // Clear selections that exceed their group cap (defensive; e.g. after a data change).
  function _clampUnitCap(e, u) {
    var used = {};
    clauses(u, e).forEach(function (cl) {
      var sel = e.sel[cl.id]; if (!sel) return;
      Object.keys(sel).forEach(function (ref) {
        if (ref === '__count' || !(sel[ref] > 0)) return;
        var uc = _optUnitCap(findOpt(cl, ref)); if (!uc || uc.cap == null) return;
        var allowed = Math.max(0, uc.cap - (used[uc.group] || 0));
        if (sel[ref] > allowed) { if (allowed === 0) delete sel[ref]; else sel[ref] = allowed; }
        used[uc.group] = (used[uc.group] || 0) + (sel[ref] || 0);
      });
      if (Object.keys(sel).length === 0) delete e.sel[cl.id];
    });
  }

  // ── Model-statline bands ────────────────────────────────────────────────────
  // A model-domain mechanics row may carry a statline BAND ({char, min, max}) that
  // selects which of an item's rows applies to a given model — and with it that row's
  // points tier. Two things are authored this way: a catalog tier (a Gift of Chaos,
  // 2 pts at T<=3 … 25 at T>=10) and a banded wargear upgrade (Adrenal Glands, 5 pts
  // at T<=3 / 15 at T>=4). The converter guarantees one band stat per item and no
  // overlaps, so at most one banded row matches a model.
  //
  // Bands are matched against the model's BASE statline, never its resolved one, so
  // two banded upgrades on one model can't re-tier each other by order of selection.
  function _statNum(v) { if (v == null) return null; var m = String(v).match(/-?\d+/); return m ? parseInt(m[0], 10) : null; }
  function _bandMatch(band, statVal) {
    if (!band) return true;                       // band-less row/tier = always applies
    var v = _statNum(statVal); if (v == null) return false;
    if (band.min != null && v < band.min) return false;
    if (band.max != null && v > band.max) return false;
    return true;
  }
  function _rowBand(row) {
    var f = (row.target || {}).filter;
    return (f && f.kind === 'modelBand') ? f.band : null;
  }
  // The model-domain rows of one mechanics block that apply to a model type: every
  // band-less row, plus the single banded row covering that model's statline (none
  // when the model falls in a band gap — the item then does nothing for it).
  function _modelRows(mech, mt) {
    var out = [], banded = null, stats = (mt && mt.stats) || {};
    ((mech && mech.rows) || []).forEach(function (row) {
      if ((row.target || {}).domain !== 'model') return;
      var band = _rowBand(row);
      if (!band) { out.push(row); return; }
      if (!banded && _bandMatch(band, stats[band.char])) banded = row;
    });
    if (banded) out.push(banded);
    return out;
  }

  // ── Resolved profile: armour/equipment statline & keywords (R1) ─────────────
  // The workbook `mechanics` (scripts/convert_upgrades.py) carry each armour/
  // equipment item's permanent model-domain deltas + keyword add/remove. The
  // displayed statline is the base model profile with the *uniformly-applied*
  // items folded in. An item applies uniformly to a model type when it is
  // unit-wide (scope who:unit) or the unit is a single model — which covers all
  // AA armour (who:unit squads / who:each single-model characters) and the
  // stat-changing equipment; per-model who:each items on squads are weapons and
  // carry no model-domain effect.
  function _factionWargearItem(slug) {
    var fw = (_data.factionWargear && _data.factionWargear.wargearItems) || [];
    for (var i = 0; i < fw.length; i++) if (fw[i].itemId === slug) return fw[i];
    return null;
  }
  function _optMechanics(o) {
    if (!o || !o.ref || o.ref.indexOf(':') === -1) return null;
    var it = _factionWargearItem(o.ref.split(':')[1]);
    return (it && it.mechanics) || null;
  }
  // The composition type a clause names (scope.modelType), or null when it targets every
  // model. Same resolution as _scopedModelCount, but returns the type rather than a count.
  function _namedModelType(u, cl) {
    var nm = cl && cl.scope && cl.scope.modelType; if (!nm) return null;
    var n = _normModelName(nm);
    if (!n || n === 'model' || n === 'unit') return null;
    var types = modelTypes(u); if (types.length <= 1) return null;
    for (var i = 0; i < types.length; i++) if (_normModelName(types[i].name) === n) return types[i];
    return null;
  }
  // How many models a clause's selections spread across: the count of the type it names,
  // else every model in the unit. Shared by the uniformity test and the partial-cover note.
  function _clauseCover(entry, u, cl) {
    var named = _namedModelType(u, cl);
    return named ? (entry.modelCounts[named.name] || 0) : totalModels(entry);
  }
  // Mechanics of every selected option that applies uniformly to a model type, in section
  // order (armour before equipment). An item applies uniformly when it is unit-wide (scope
  // who:unit), the unit is a single model, or — for a per-model clause — EVERY model the
  // clause can land on took that same option. Scope alone is not enough: a who:each item
  // may carry permanent model-domain effects (a Storm Shield's +2 W, a Slab Shield's whole
  // profile), and one statline row can only speak for the type when every model has it.
  // Partially-taken items are reported separately by partialModelEffects.
  function _uniformMechs(entry, u, mt) {
    var N = totalModels(entry), out = [];
    clauses(u, entry).forEach(function (cl) {
      var unitScope = cl.scope && cl.scope.who === 'unit';
      var uniform = !!unitScope || N === 1, cover = 0;
      if (!uniform) {
        var named = _namedModelType(u, cl);
        if (named && mt && named.name !== mt.name) return;   // lands on a different type
        cover = _clauseCover(entry, u, cl);
        if (!(cover > 0)) return;
      }
      var sel = entry.sel[cl.id] || {};
      Object.keys(sel).forEach(function (ref) {
        if (ref === '__count' || !(sel[ref] > 0)) return;
        if (!uniform && sel[ref] < cover) return;            // only some models have it
        var m = _optMechanics(findOpt(cl, ref)); if (m) out.push(m);
      });
    });
    return out;
  }
  // Apply an inc/dec/set effect to a base characteristic value, preserving any
  // suffix ("6\"" → "7\"") for inc/dec; set replaces outright ("2+", "12\"").
  function _applyStatDelta(baseVal, eff) {
    if (eff.op === 'set') return eff.value;
    var m = String(baseVal == null ? '' : baseVal).match(/^(-?\d+)(.*)$/);
    if (!m) return baseVal;
    var n = parseInt(m[1], 10) + (eff.op === 'inc' ? eff.value : -eff.value);
    return String(n) + (m[2] || '');
  }
  function _kwAddRemove(kw, k) {
    (k.remove || []).forEach(function (r) { kw = kw.filter(function (x) { return x.toLowerCase() !== String(r).toLowerCase(); }); });
    (k.add || []).forEach(function (a) { if (!kw.some(function (x) { return x.toLowerCase() === String(a).toLowerCase(); })) kw.push(a); });
    return kw;
  }
  // Base + armour/equipment (model-domain) keyword effects (before trait effects).
  function _armourKeywords(entry, mt) {
    var u = getUnitData(entry.unitName);
    var kw = ((mt && mt.keywords) || u.keywords || []).slice();
    _uniformMechs(entry, u, mt).forEach(function (mech) {
      _modelRows(mech, mt).forEach(function (row) { kw = _kwAddRemove(kw, row.keywords || {}); });
    });
    return kw;
  }
  // ── Detachment-trait effects on units (R4) ──────────────────────────────────
  // Active traits' unit-domain effects apply to units whose *resolved* keywords
  // (or unit name) match target.eligibility — e.g. Souls of Iron → Infantry gain
  // Implacable; 1st Company → Veterans gain / Intercessors lose Battleline. Weapon-
  // domain trait grants (Lance/Assault) are purely in-game and stay prose text.
  function _activeTraits() { return _state.detachmentTraitsSelected.map(_traitById).filter(Boolean); }
  // A row tagged with `choice` is one option of a decision the trait puts to the player
  // (see trait.choices) — it applies only once that option is picked. Untagged rows are
  // unconditional. This one gate is what keeps Aspect Host from handing Battleline to
  // all eight Aspect Warriors units at once.
  function _rowChosen(trait, row) {
    if (!row.choice) return true;
    var picks = ((_state.detachmentTraitChoices || {})[trait.traitId] || {})[row.choice.group] || [];
    return picks.indexOf(row.choice.option) !== -1;
  }
  // Every unit-domain row of every active trait that is live right now.
  function _liveTraitRows() {
    var rows = [];
    _activeTraits().forEach(function (t) {
      ((t.mechanics && t.mechanics.rows) || []).forEach(function (row) {
        if (row.target && row.target.domain === 'unit' && _rowChosen(t, row)) rows.push(row);
      });
    });
    return rows;
  }
  // eligibility is OR-of-AND: a list of groups, each a list of AND-terms. Match if
  // ANY group's terms are all present (in the unit's keywords or its name).
  // 'Tacticus | Gravis' → [[Tacticus],[Gravis]] (either); 'Infantry + Regiment' →
  // [[Infantry,Regiment]] (both). Blank/[] → match any.
  function _matchElig(eligibility, kwsLower, nameLower) {
    if (!eligibility || !eligibility.length) return true;   // blank = any
    return eligibility.some(function (group) {
      var terms = Array.isArray(group) ? group : [group];   // tolerate a flat string
      return terms.every(function (tok) {
        var t = String(tok).toLowerCase();
        return kwsLower.indexOf(t) !== -1 || nameLower === t;
      });
    });
  }
  function _matchingTraitRows(entry, u, mt) {
    var kwsLower = _armourKeywords(entry, mt).map(function (x) { return x.toLowerCase(); });
    var nameLower = (u.name || '').toLowerCase();
    return _liveTraitRows().filter(function (row) {
      return _matchElig(row.target.eligibility, kwsLower, nameLower);
    });
  }
  function _applyStatRows(stats, rows) {
    rows.forEach(function (row) {
      (row.modelStats || []).forEach(function (eff) {
        if (stats[eff.char] !== undefined && stats[eff.char] !== null) stats[eff.char] = _applyStatDelta(stats[eff.char], eff);
        else if (eff.op === 'set') stats[eff.char] = eff.value;
      });
    });
  }
  // Gift tiers to apply to a model type: unit-scope selections (all models of the
  // type) plus any instance-specific ids (a champion's or a per-model instance's picks).
  function _giftTiersFor(entry, u, mt, extraGiftIds) {
    var tiers = _unitGiftTiers(entry, u, mt);
    (extraGiftIds || []).forEach(function (id) { var t = giftTier(catalogItem(id), mt); if (t) tiers.push(t); });
    return tiers;
  }
  function resolvedStats(entry, mt, extraGiftIds) {
    var u = getUnitData(entry.unitName);
    var stats = Object.assign({}, mt.stats || {});
    var armourRows = [];
    _uniformMechs(entry, u, mt).forEach(function (mech) {
      armourRows = armourRows.concat(_modelRows(mech, mt));
    });
    _applyStatRows(stats, armourRows);                     // armour/equipment (R1)
    _giftTiersFor(entry, u, mt, extraGiftIds).forEach(function (t) { _applyStatRows(stats, [{ modelStats: t.modelStats }]); });
    _applyStatRows(stats, _matchingTraitRows(entry, u, mt)); // matching traits (R4)
    return stats;
  }
  function resolvedKeywords(entry, mt, extraGiftIds) {
    var u = getUnitData(entry.unitName);
    var kw = _armourKeywords(entry, mt);
    _giftTiersFor(entry, u, mt, extraGiftIds).forEach(function (t) { kw = _kwAddRemove(kw, t.keywords || {}); });
    _matchingTraitRows(entry, u, mt).forEach(function (row) { kw = _kwAddRemove(kw, row.keywords || {}); });
    return kw;
  }
  // Per-model items that only SOME of a model type's models carry, so the single statline
  // row cannot speak for them (see _uniformMechs). Each entry carries the profile those
  // models actually have — the row's resolved statline plus that one item — leaving the
  // caller to diff it against the row and show only the characteristics that moved.
  // Two partial items are reported independently: a per-model clause records how MANY
  // models took an option, never WHICH, so whether they land on the same models is unknowable.
  function partialModelEffects(entry, mt) {
    var u = getUnitData(entry.unitName), N = totalModels(entry), out = [];
    if (!u || N <= 1) return out;
    var rowStats = resolvedStats(entry, mt), rowKw = resolvedKeywords(entry, mt);
    clauses(u, entry).forEach(function (cl) {
      if (cl.scope && cl.scope.who === 'unit') return;      // uniform by definition
      var named = _namedModelType(u, cl);
      if (named && named.name !== mt.name) return;          // lands on a different type
      var cover = _clauseCover(entry, u, cl);
      if (cover <= 0) return;
      var sel = entry.sel[cl.id] || {};
      Object.keys(sel).forEach(function (ref) {
        var n = sel[ref] || 0;
        if (ref === '__count' || n <= 0 || n >= cover) return;   // none, or all → not partial
        var o = findOpt(cl, ref), mech = _optMechanics(o); if (!mech) return;
        var rows = _modelRows(mech, mt); if (!rows.length) return;
        var stats = Object.assign({}, rowStats), kw = rowKw.slice();
        _applyStatRows(stats, rows);
        rows.forEach(function (row) { kw = _kwAddRemove(kw, row.keywords || {}); });
        var added = kw.filter(function (k) { return rowKw.indexOf(k) === -1; });
        var removed = rowKw.filter(function (k) { return kw.indexOf(k) === -1; });
        var moved = Object.keys(stats).some(function (c) { return String(stats[c]) !== String(rowStats[c]); });
        if (!moved && !added.length && !removed.length) return;   // item changes nothing here
        out.push({ name: (o && o.name) || ref, count: Math.min(n, cover), of: cover,
                   stats: stats, keywordsAdded: added, keywordsRemoved: removed });
      });
    });
    return out;
  }

  // Force-org keywords for a unit definition: base + active-trait unit-domain
  // keyword effects (Battleline add/remove etc.), tested against base keywords /
  // name. Armour doesn't change org-relevant keywords, so this is per unit-name.
  function _orgKeywords(ud) {
    var kw = (ud.keywords || []).slice();
    var kwsLower = kw.map(function (x) { return x.toLowerCase(); }), nameLower = (ud.name || '').toLowerCase();
    _liveTraitRows().forEach(function (row) {
      if (_matchElig(row.target.eligibility, kwsLower, nameLower)) kw = _kwAddRemove(kw, row.keywords || {});
    });
    return kw;
  }

  // ── Key unit characteristics (Path of Study, Harnessed God, Shaper's Path …) ──
  // A selection made inside a unit that confers wargear, abilities and points on it.
  // Two sources, both authored as one H6 section under the unit:
  //   inline  — the options are `profiles[]`, each owning ordinary clauses. Selecting a
  //             profile is what makes those clauses live (see `clauses` above), so its
  //             wargear is priced and controlled by the existing machinery.
  //   catalog — the options come from the faction upgrade catalog and are selected
  //             through the existing gifts/allowance path; nothing extra is needed here.
  var SEC_KEYCHAR = 'keyCharacteristic';

  function keyCharSections(u) {
    return (unitOptions(u).sections || []).filter(function (s) { return s.key === SEC_KEYCHAR; });
  }
  function keyCharInline(u) {
    return keyCharSections(u).filter(function (s) { return s.source !== 'catalog'; });
  }
  function keyCharSection(u, secId) {
    var all = keyCharSections(u);
    for (var i = 0; i < all.length; i++) if (all[i].id === secId) return all[i];
    return null;
  }
  function _keyChar(e) { return e.keyChar || (e.keyChar = {}); }
  function keyCharSelection(entry, secId) { return (entry.keyChar || {})[secId] || []; }
  function keyCharSelected(entry, secId, profileId) {
    return keyCharSelection(entry, secId).indexOf(profileId) !== -1;
  }
  function _selectMax(sec) { return ((sec && sec.select) || {}).max || 1; }
  function _selectMin(sec) { return ((sec && sec.select) || {}).min || 0; }

  // Select (or, above the minimum, de-select) a profile. A max-1 section behaves as a
  // radio — picking a new profile replaces the old one rather than being refused.
  function selectKeyChar(entryId, secId, profileId) {
    var e = _entry(entryId); if (!e) return;
    var u = getUnitData(e.unitName);
    var sec = keyCharSection(u, secId); if (!sec || sec.source === 'catalog') return;
    if (!(sec.profiles || []).some(function (p) { return p.id === profileId; })) return;
    var lst = _keyChar(e)[secId] || (_keyChar(e)[secId] = []);
    var at = lst.indexOf(profileId), max = _selectMax(sec);
    if (at !== -1) {
      if (lst.length <= _selectMin(sec)) return;   // compulsory: can't drop the last one
      lst.splice(at, 1);
    } else if (max === 1) {
      lst.length = 0; lst.push(profileId);         // radio
    } else if (lst.length < max) {
      lst.push(profileId);
    } else {
      return;                                      // at cap
    }
    if (!lst.length) delete e.keyChar[secId];
    _clampKeyChar(e, u);
    calcUnitPoints(e); saveState();
  }

  // Drop selections for sections/profiles that no longer exist, enforce the cap, and —
  // the important part — clear any option selections that belonged to a profile the
  // player has switched away from. Those clauses are no longer live, so their entries in
  // `sel`/`nested`/`relic` would otherwise linger and keep being billed.
  function _clampKeyChar(e, u) {
    var secs = keyCharInline(u);
    var g = e.keyChar;
    if (g) {
      Object.keys(g).forEach(function (secId) {
        var sec = keyCharSection(u, secId);
        if (!sec || sec.source === 'catalog') { delete g[secId]; return; }
        var valid = (sec.profiles || []).map(function (p) { return p.id; });
        var lst = g[secId].filter(function (id) { return valid.indexOf(id) !== -1; });
        if (lst.length > _selectMax(sec)) lst = lst.slice(0, _selectMax(sec));
        if (lst.length) g[secId] = lst; else delete g[secId];
      });
    }
    // Auto-select for a compulsory section with nothing chosen (new unit, or the data
    // changed under a saved list) so the unit is never silently invalid.
    secs.forEach(function (sec) {
      if (_selectMin(sec) < 1) return;
      if (keyCharSelection(e, sec.id).length) return;
      var first = (sec.profiles || [])[0];
      if (first) _keyChar(e)[sec.id] = [first.id];
    });
    // Purge selections owned by now-inactive profiles.
    var live = {};
    clauses(u, e).forEach(function (cl) { live[cl.id] = 1; });
    secs.forEach(function (sec) {
      (sec.profiles || []).forEach(function (pr) {
        (pr.clauses || []).forEach(function (cl) {
          if (live[cl.id]) return;
          if (e.sel) delete e.sel[cl.id];
          if (e.relic) Object.keys(e.relic).forEach(function (k) {
            if (k.indexOf(cl.id + '::') === 0) delete e.relic[k];
          });
          if (e.nested) Object.keys(e.nested).forEach(function (k) {
            if (k.indexOf(cl.id + '::') === 0) delete e.nested[k];
          });
          if (e.instanceCount) Object.keys(e.instanceCount).forEach(function (k) {
            if (k.indexOf(cl.id + '::') === 0) delete e.instanceCount[k];
          });
        });
      });
    });
  }

  // Points a profile adds: its authored flat cost, else the sum of its compulsory
  // (fixed) clauses. Choose/add clauses inside a profile are billed by the player's own
  // picks through calcUnitPoints, so they are shown as "from" rather than counted here.
  function keyCharProfileCost(entry, u, sec, pr) {
    if (pr.points != null) return pr.points;
    var total = 0;
    (pr.clauses || []).forEach(function (cl) {
      if (cl.op !== 'fixed') return;
      var n = entry ? _fixedN(entry, cl) : 1;   // option.points already bakes in qty
      (cl.options || []).forEach(function (o) { total += (o.points || 0) * n; });
    });
    return total;
  }
  // True when a profile's own cost is only a floor (it still has picks to make).
  function keyCharProfileHasPicks(pr) {
    return (pr.clauses || []).some(function (cl) { return cl.op !== 'fixed'; });
  }

  // ── Selectable upgrade catalogs (Gifts of Chaos etc.) ───────────────────────
  // A faction may expose a catalog of statline-tiered, per-unit-entitled upgrades
  // (data/upgrade-catalogs/{slug}.json). Each unit carries `upgradeAllowance` — a
  // list of {scope, count, distinct, modelType} entitlements. Scope semantics:
  //   'unit'     → one shared selection applied to every model of `modelType`
  //                (priced per model of that type)
  //   'champion' → applied to the unit's single champion model of `modelType` (×1)
  //   'model'    → each model instance of `modelType` selects independently
  // A catalog item ("Mark of Khorne") has Toughness-banded tiers; the tier for a
  // model is chosen by that model's own statline, and carries the points + effects.
  function _catalogs() { return (_data.upgradeCatalog && _data.upgradeCatalog.catalogs) || []; }
  function unitCatalog() { return _catalogs()[0] || null; }   // one catalog per faction for now
  function catalogItem(id) {
    var cats = _catalogs();
    for (var i = 0; i < cats.length; i++) {
      var items = cats[i].items || [];
      for (var j = 0; j < items.length; j++) if (items[j].id === id) return items[j];
    }
    return null;
  }
  function unitAllowances(u) { return (u && u.upgradeAllowance) || []; }
  function _allowancesByScope(u, scope) {
    return unitAllowances(u).filter(function (a) { return a.scope === scope; });
  }
  function allowanceKey(a) { return a.scope + '::' + a.modelType; }
  function _mtByName(u, name) {
    var mts = modelTypes(u);
    for (var i = 0; i < mts.length; i++) if (mts[i].name === name) return mts[i];
    return mts[0];
  }
  // Which tier of a catalog item applies to a model type (by its statline), or null
  // if the model falls in a band gap (item not takeable on that model). Bands and
  // their matching rule are shared with banded wargear — see _bandMatch above.
  function giftTier(item, mt) {
    if (!item) return null;
    var tiers = item.tiers || [];
    for (var i = 0; i < tiers.length; i++) {
      var b = tiers[i].band;
      if (_bandMatch(b, b ? (mt.stats || {})[b.char] : null)) return tiers[i];
    }
    return null;
  }
  function giftTakeable(item, mt) { return giftTier(item, mt) != null; }

  function _gifts(e) { return e.gifts || (e.gifts = {}); }
  // Current selection for an allowance: an id array (unit/champion) or, for 'model'
  // scope, the id array for one model instance (modelIdx).
  function giftSelection(entry, a, modelIdx) {
    var g = entry.gifts || {}, key = allowanceKey(a);
    if (a.scope === 'model') return ((g[key] || {})[modelIdx]) || [];
    return g[key] || [];
  }
  // Toggle a gift on/off for an allowance (and, for 'model' scope, a model instance),
  // honouring the allowance's count cap and distinct rule.
  function toggleGift(entryId, a, giftId, modelIdx) {
    var e = _entry(entryId); if (!e) return;
    var u = getUnitData(e.unitName);
    var mt = _mtByName(u, a.modelType);
    if (!giftTakeable(catalogItem(giftId), mt)) return;   // no tier for this model — not selectable
    var g = _gifts(e), key = allowanceKey(a);
    if (a.scope === 'model') {
      var byIdx = g[key] || (g[key] = {});
      var lst = byIdx[modelIdx] || (byIdx[modelIdx] = []);
      _toggleGiftInList(lst, giftId, a.count);
      if (!lst.length) delete byIdx[modelIdx];
      if (!Object.keys(byIdx).length) delete g[key];
    } else {
      var l2 = g[key] || (g[key] = []);
      _toggleGiftInList(l2, giftId, a.count);
      if (!l2.length) delete g[key];
    }
    calcUnitPoints(e); saveState();
  }
  function _toggleGiftInList(lst, id, cap) {
    var i = lst.indexOf(id);
    if (i >= 0) { lst.splice(i, 1); return; }   // off (distinct → id present at most once)
    if (lst.length >= cap) return;              // at count cap → ignore
    lst.push(id);
  }
  // Re-clamp gift selections after composition changes: drop selections for removed
  // allowances, per-model instances beyond the current count, and over-cap lists.
  function _clampGifts(e, u) {
    var g = e.gifts; if (!g) return;
    var valid = {};
    unitAllowances(u).forEach(function (a) { valid[allowanceKey(a)] = a; });
    Object.keys(g).forEach(function (key) {
      var a = valid[key];
      if (!a) { delete g[key]; return; }
      var c = e.modelCounts[a.modelType] || 0;
      if (a.scope === 'model') {
        var byIdx = g[key];
        Object.keys(byIdx).forEach(function (idx) {
          if (parseInt(idx, 10) >= c) { delete byIdx[idx]; return; }
          if (byIdx[idx].length > a.count) byIdx[idx] = byIdx[idx].slice(0, a.count);
        });
        if (!Object.keys(byIdx).length) delete g[key];
      } else {
        if (c < 1) { delete g[key]; return; }   // no models of this type → no unit/champion gift
        if (g[key].length > a.count) g[key] = g[key].slice(0, a.count);
      }
    });
  }
  // Unit-scope gift tiers applying to a model type (for statline + keyword resolution).
  function _unitGiftTiers(entry, u, mt) {
    var out = [];
    _allowancesByScope(u, 'unit').forEach(function (a) {
      if (a.modelType !== mt.name) return;
      giftSelection(entry, a).forEach(function (id) {
        var t = giftTier(catalogItem(id), mt); if (t) out.push(t);
      });
    });
    return out;
  }
  // Total points from all gift selections on a unit (per-model priced).
  function giftsCost(entry, u) {
    var total = 0;
    unitAllowances(u).forEach(function (a) {
      var mt = _mtByName(u, a.modelType), c = entry.modelCounts[a.modelType] || 0;
      if (a.scope === 'model') {
        var byIdx = (entry.gifts || {})[allowanceKey(a)] || {};
        Object.keys(byIdx).forEach(function (idx) {
          (byIdx[idx] || []).forEach(function (id) { var t = giftTier(catalogItem(id), mt); if (t) total += t.points; });
        });
      } else {
        var mult = (a.scope === 'champion') ? 1 : c;   // unit = every model of type; champion = 1
        giftSelection(entry, a).forEach(function (id) { var t = giftTier(catalogItem(id), mt); if (t) total += t.points * mult; });
      }
    });
    return total;
  }

  // ── Relic Weapon upgrade (per equipped weapon) ──────────────────────────────
  // The "any weapon ... can be upgraded as a Relic Weapon" clause (op:modifier, no
  // appliesTo). The upgrade attaches to individual equipped weapons rather than a
  // flat counter, so the player can see which weapons are relics.
  function relicModifier(u) {
    var all = clauses(u);
    for (var i = 0; i < all.length; i++)
      if (all[i].op === 'modifier' && !all[i].appliesTo) return all[i];
    return null;
  }
  function relicEligible(relicCl, o) {
    if (!relicCl || !o || o.kind !== 'weapon') return false;
    var ex = relicCl.scope && relicCl.scope.requires && relicCl.scope.requires.excludeKeyword;
    if (ex && _weaponKeywords(o.name).indexOf(String(ex).toLowerCase()) !== -1) return false;
    return true;
  }
  // How many instances of an option's weapon are equipped (= max relic upgrades for it).
  function optEquipped(entry, u, cl, o) {
    var N = totalModels(entry), qty = o.qty || 1;
    if (cl.op === 'fixed') return qty * _fixedN(entry, cl);
    var c = (entry.sel[cl.id] || {})[o.ref] || 0;
    if (!c) return 0;
    if (cl.scope && cl.scope.who === 'unit') return qty * N;
    return qty * c;
  }
  function setRelic(id, clauseId, optRef, delta) {
    var e = _entry(id); if (!e) return;
    var u = getUnitData(e.unitName); var cl = findClause(u, clauseId); if (!cl) return;
    var o = findOpt(cl, optRef); if (!o) return;
    if (!e.relic) e.relic = {};
    var key = clauseId + '::' + optRef;
    var cap = optEquipped(e, u, cl, o);
    var nv = Math.max(0, Math.min(cap, (e.relic[key] || 0) + delta));
    if (nv === 0) delete e.relic[key]; else e.relic[key] = nv;
    calcUnitPoints(e); saveState();
  }
  // Clamp relic counts when the underlying weapon selections shrink/disappear.
  function _clampRelic(e, u) {
    if (!e.relic) return;
    Object.keys(e.relic).forEach(function (key) {
      var i = key.indexOf('::');
      var cl = i > 0 ? findClause(u, key.slice(0, i)) : null;
      var o = cl ? findOpt(cl, key.slice(i + 2)) : null;
      var cap = (cl && o) ? optEquipped(e, u, cl, o) : 0;
      if (e.relic[key] > cap) e.relic[key] = cap;
      if (e.relic[key] <= 0) delete e.relic[key];
    });
  }

  // ── Weapon cost lookup (for replace subtraction) ────────────────────────────
  function _maxStrength(w) {
    var vals = [];
    if (w.strength != null) vals.push(w.strength);
    (w.profiles || []).forEach(function (p) { if (p.strength != null) vals.push(p.strength); });
    var out = vals.map(function (v) { return parseInt(String(v).replace('+', '').trim(), 10); })
                  .filter(function (n) { return !isNaN(n); });
    return out.length ? Math.max.apply(null, out) : 0;
  }
  function _weaponCost(name) {
    if (!name) return 0;
    var n = String(name).trim().toLowerCase();
    var qty = 1;
    var qm = n.match(/^(\d+)\s*x?\s+/);            // "2x Twin-linked Lascannon" → qty 2
    if (qm) { qty = parseInt(qm[1], 10) || 1; n = n.slice(qm[0].length).trim(); }
    var weapons = (_data.units && _data.units.weapons) || [];
    var fw = (_data.factionWargear && _data.factionWargear.wargearItems) || [];
    var cost = null;
    for (var i = 0; i < weapons.length; i++)
      if ((weapons[i].name || '').trim().toLowerCase() === n && weapons[i].points != null) { cost = weapons[i].points; break; }
    if (cost == null) for (var j = 0; j < fw.length; j++)
      if ((fw[j].name || '').trim().toLowerCase() === n && fw[j].pointsCost != null) { cost = fw[j].pointsCost; break; }
    if (cost == null) {
      var m = n.match(/^twin-linked\s+(.+)$/);
      if (m) for (var k = 0; k < weapons.length; k++)
        if ((weapons[k].name || '').trim().toLowerCase() === m[1] && weapons[k].points != null) {
          var base = weapons[k].points, s = _maxStrength(weapons[k]);
          cost = base + (s >= 9 ? base : Math.ceil(base / 2)); break;
        }
    }
    return (cost || 0) * qty;
  }
  // ── Weapon-modifier pricing (Relic Weapon & friends) ────────────────────────
  // A weapon's compulsory modifiers are encoded in its option ref suffix, e.g.
  // "weapon:plasma-cannon#m-twin-linked+accursed" (see convert_options.py).
  function _modsFromRef(ref) {
    var m = String(ref || '').match(/#m-([^#]+)/);
    return m ? m[1].split('+') : [];
  }
  function _slugify(text) {
    return String(text).toLowerCase().replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  function _weaponByRef(ref) {
    var slug = String(ref || '').split(':')[1];
    if (!slug) return null;
    slug = slug.split('#')[0];
    var weapons = (_data.units && _data.units.weapons) || [];
    for (var i = 0; i < weapons.length; i++)
      if (_slugify(weapons[i].name) === slug) return weapons[i];
    return null;
  }
  var _modRegistryCache = null, _modRegistryFor = null;
  function _modRegistry() {
    var items = (_data.factionWargear && _data.factionWargear.wargearItems) || null;
    if (!items || !window.AH_WMOD) return null;
    if (_modRegistryFor !== items) {
      _modRegistryCache = window.AH_WMOD.buildRegistry(items);
      _modRegistryFor = items;
    }
    return _modRegistryCache;
  }
  // Cost of adding one modifier to one instance of a weapon, as the difference between
  // the weapon resolved with and without it. This is NOT always the modifier's flat
  // pointsPerWeapon: Twin-linked's surcharge is tiered by the weapon's *effective*
  // Strength, so upgrading a Twin-linked S8 weapon to a Relic Weapon (S+1) re-tiers
  // that surcharge too. Falls back to the flat cost when the weapon can't be resolved.
  function _modifierMarginalCost(ref, modSlug, fallback) {
    var reg = _modRegistry(), w = _weaponByRef(ref);
    if (!reg || !w || !modSlug) return fallback;
    var base = _modsFromRef(ref);
    if (base.indexOf(modSlug) !== -1) return 0;          // already carries it
    var before = window.AH_WMOD.resolve(w, base, reg).points;
    var after  = window.AH_WMOD.resolve(w, base.concat([modSlug]), reg).points;
    if (before == null || after == null) return fallback;
    return after - before;
  }

  function _replacedCost(replaces) {
    if (!replaces || replaces.slot) return 0;          // slot replaces use the pool (no subtraction)
    if (replaces.weapons) return replaces.weapons.reduce(function (s, w) { return s + _weaponCost(w); }, 0);
    if (replaces.weapon) return _weaponCost(replaces.weapon);
    return 0;
  }
  // ── Sub-selections (combi weapons, turrets, warsuits, sponsons) ──────────────
  // A faction-wargear item may declare one or more independent sub-selection GROUPS
  // (subSelections[]), an optional per-item quantity multiplier (instances), and a
  // suppression flag (suppressesWeaponOptions). Selecting the item on a model exposes
  // its groups; picks are stored per equipped model instance so a squad's models can
  // differ (per-model divergence). Instance-items (sponsons) use one shared pick set
  // multiplied by a chosen count.
  function _itemForRef(ref) {
    if (!ref) return null;
    var slug = ref.split(':')[1]; if (!slug) return null;
    slug = slug.split('#')[0];              // strip qty/modifier/compound suffixes
    var fw = (_data.factionWargear && _data.factionWargear.wargearItems) || [];
    for (var i = 0; i < fw.length; i++) if (fw[i].itemId === slug) return fw[i];
    return null;
  }
  function itemSubSelections(ref) { var it = _itemForRef(ref); return (it && it.subSelections) || null; }
  function itemInstances(ref) { var it = _itemForRef(ref); return (it && it.instances) || null; }
  function itemSuppresses(ref) { return !!(_itemForRef(ref) || {}).suppressesWeaponOptions; }
  // Weapons auto-included with the item (no choice), e.g. Wings → Wing Barbs. Their
  // cost is added on top of the item, per equipped model instance (× count for instances).
  function itemIncludedWeapons(ref) { var it = _itemForRef(ref); return (it && it.includedWeapons) || null; }
  function includedWeaponCost(entry, u, cl, optRef) {
    var inc = itemIncludedWeapons(optRef); if (!inc || !inc.length) return 0;
    var per = 0; inc.forEach(function (w) { per += w.points || 0; });
    var mult = itemInstances(optRef) ? instanceCountFor(entry, cl.id, optRef) : equippedInstances(entry, u, cl, optRef);
    return per * mult;
  }
  function _subGroup(subs, groupId) {
    for (var i = 0; i < (subs || []).length; i++) if (subs[i].id === groupId) return subs[i];
    return null;
  }
  function _subOptPoints(subs, groupId, subRef) {
    var g = _subGroup(subs, groupId); if (!g) return 0;
    for (var i = 0; i < (g.options || []).length; i++) if (g.options[i].ref === subRef) return g.options[i].points || 0;
    return 0;
  }
  function nestedKey(clauseId, optRef) { return clauseId + '::' + optRef; }

  // Number of equipped model instances of an option (per-model divergence axis):
  // fixed → all models; unselected → 0; who:unit (selected) → all models;
  // otherwise the selected count on this clause.
  function equippedInstances(entry, u, cl, optRef) {
    var N = totalModels(entry);
    if (cl.op === 'fixed') return _fixedN(entry, cl);
    var sel = (entry.sel[cl.id] || {})[optRef] || 0;
    if (!sel) return 0;
    return (cl.scope && cl.scope.who === 'unit') ? N : sel;
  }
  // The chosen instance count for an instances-item (default = first allowed count).
  function instanceCountFor(entry, clauseId, optRef) {
    var inst = itemInstances(optRef); if (!inst) return 1;
    var v = (entry.instanceCount || {})[nestedKey(clauseId, optRef)];
    return (v != null && inst.counts.indexOf(v) !== -1) ? v : inst.counts[0];
  }
  function nestedPicks(entry, clauseId, optRef, modelIdx, groupId) {
    var m = (entry.nested && entry.nested[nestedKey(clauseId, optRef)]) || {};
    return (m[modelIdx] && m[modelIdx][groupId]) || [];
  }
  // Total sub-selection cost for one selected option (per-model summed, or ×count for
  // instance-items). The item's own flat cost is handled by the clause option.points.
  function subSelectionCost(entry, u, cl, optRef) {
    var subs = itemSubSelections(optRef); if (!subs) return 0;
    var byModel = (entry.nested && entry.nested[nestedKey(cl.id, optRef)]) || {};
    function sumPicks(picks) {
      var s = 0;
      Object.keys(picks || {}).forEach(function (gid) {
        (picks[gid] || []).forEach(function (r) { s += _subOptPoints(subs, gid, r); });
      });
      return s;
    }
    if (itemInstances(optRef)) return sumPicks(byModel['0']) * instanceCountFor(entry, cl.id, optRef);
    var k = equippedInstances(entry, u, cl, optRef), total = 0;
    for (var i = 0; i < k; i++) total += sumPicks(byModel[i]);
    return total;
  }
  // A sub-selection group may replace a named STANDARD weapon ("…can replace its Bolt
  // Pistol with 1 of the following:"): when a model has an active pick in that group,
  // it gives up the default weapon. Returns { weaponNameLower: count of models }.
  function replacedStandardWeapons(entry, u) {
    var map = {};
    clauses(u, entry).forEach(function (cl) {
      (cl.options || []).forEach(function (o) {
        var subs = itemSubSelections(o.ref); if (!subs) return;
        var reps = subs.filter(function (g) { return g.replaces; }); if (!reps.length) return;
        var inst = itemInstances(o.ref), k = inst ? 1 : equippedInstances(entry, u, cl, o.ref);
        var byModel = (entry.nested && entry.nested[nestedKey(cl.id, o.ref)]) || {}, mult = inst ? instanceCountFor(entry, cl.id, o.ref) : 1;
        for (var i = 0; i < k; i++) {
          var picks = byModel[inst ? '0' : i] || {};
          reps.forEach(function (g) {
            if ((picks[g.id] || []).length) { var nm = String(g.replaces).trim().toLowerCase(); map[nm] = (map[nm] || 0) + mult; }
          });
        }
      });
    });
    return map;
  }
  // Points subtracted for replaced standard weapons (their cost × models that gave them up).
  function replacedStandardCost(entry, u) {
    var map = replacedStandardWeapons(entry, u), total = 0;
    Object.keys(map).forEach(function (nm) { total += _weaponCost(nm) * map[nm]; });
    return total;
  }

  // ── Suppression: an item that replaces the unit's normal weapon options ──────
  // Models equipped with a `suppressesWeaponOptions` item (e.g. Paragon Warsuit)
  // don't take the unit's normal Ranged/Melee Wargear-Options weapon clauses — those
  // clauses' effective model pool is reduced by the number of suppressed models.
  function suppressedModelCount(entry, u) {
    var n = 0;
    clauses(u, entry).forEach(function (cl) {
      (cl.options || []).forEach(function (o) {
        if (itemSuppresses(o.ref)) n += equippedInstances(entry, u, cl, o.ref);
      });
    });
    return Math.min(n, totalModels(entry));
  }
  // A clause whose weapon options are replaced when a model is suppressed: a
  // wargear-options weapon clause that isn't itself the clause granting the item.
  function isSuppressibleClause(u, cl) {
    if (cl.__section !== 'wargearOptions' || cl.op === 'modifier' || cl.op === 'fixed') return false;
    var opts = cl.options || [];
    if (!opts.length || opts.some(function (o) { return itemSuppresses(o.ref); })) return false;
    return opts.some(function (o) { return o.kind === 'weapon'; });
  }
  // A model count reduced by suppression for a suppressible clause (else unchanged).
  function _suppress(entry, u, cl, count) {
    if (!isSuppressibleClause(u, cl)) return count;
    return Math.max(0, count - Math.min(count, suppressedModelCount(entry, u)));
  }
  // Clear selections on suppressed clauses (e.g. a Melta Pistol chosen before the
  // model took a Paragon Warsuit). Clamps each option to its now-reduced cap.
  function _clampSuppressed(e, u) {
    clauses(u, e).forEach(function (cl) {
      if (!isSuppressibleClause(u, cl)) return;
      var sel = e.sel[cl.id]; if (!sel) return;
      Object.keys(sel).forEach(function (ref) {
        if (ref === '__count') return;
        var cap = optionCap(e, u, cl, ref);
        if (sel[ref] > cap) sel[ref] = cap;
        if (sel[ref] <= 0) delete sel[ref];
      });
      if (Object.keys(sel).length === 0) delete e.sel[cl.id];
    });
  }

  // ── Sub-selection Relic upgrade (item.relicUpgrade on Paragon weapons, etc.) ──
  // An item may let its own sub-selection weapons be upgraded (e.g. to a Relic
  // Weapon). Marks are per (clause, option, model instance, group, sub-weapon).
  function itemRelicUpgrade(ref) { return (_itemForRef(ref) || {}).relicUpgrade || null; }
  function subRelicKey(clauseId, optRef, modelIdx, groupId, subRef) {
    return clauseId + '::' + optRef + '::' + modelIdx + '::' + groupId + '::' + subRef;
  }
  // Can this sub-weapon be upgraded? weapon kind, not the excluded keyword, and (if
  // the upgrade is Leader-only) the unit must have the Leader keyword.
  function subRelicEligible(u, relicUp, so) {
    if (!relicUp || !so || so.kind !== 'weapon') return false;
    if (relicUp.requiresLeader && !(u.keywords || []).some(function (k) { return k.toLowerCase() === 'leader'; })) return false;
    if (/\bgrenades?$/i.test(so.name || '')) return false;   // thrown grenades are never relics (keeps "Grenade Launcher" eligible)
    var ex = relicUp.excludeKeyword;
    if (ex && _weaponKeywords(so.name).indexOf(String(ex).toLowerCase()) !== -1) return false;
    return true;
  }
  function subRelicMarked(entry, clauseId, optRef, modelIdx, groupId, subRef) {
    return !!(entry.subRelic && entry.subRelic[subRelicKey(clauseId, optRef, modelIdx, groupId, subRef)]);
  }
  function setSubRelic(id, clauseId, optRef, modelIdx, groupId, subRef, on) {
    var e = _entry(id); if (!e) return;
    if (!e.subRelic) e.subRelic = {};
    var key = subRelicKey(clauseId, optRef, modelIdx, groupId, subRef);
    if (on) e.subRelic[key] = 1; else delete e.subRelic[key];
    calcUnitPoints(e); saveState();
  }
  // Drop relic marks whose underlying sub-weapon is no longer picked (pick changed,
  // item deselected, or model instance removed — run AFTER _clampNested).
  function _clampSubRelic(e, u) {
    if (!e.subRelic) return;
    Object.keys(e.subRelic).forEach(function (key) {
      var p = key.split('::');   // clauseId::optRef::modelIdx::groupId::subRef
      if (nestedPicks(e, p[0], p[1], p[2], p[3]).indexOf(p[4]) === -1) delete e.subRelic[key];
    });
  }
  // Total sub-selection relic cost over marked (still-picked) weapons. Priced the same
  // way as unit-level relics — see _modifierMarginalCost.
  function subRelicCost(entry) {
    if (!entry.subRelic) return 0;
    var total = 0;
    Object.keys(entry.subRelic).forEach(function (key) {
      var p = key.split('::');                 // clauseId::optRef::modelIdx::groupId::subRef
      var ru = itemRelicUpgrade(p[1]);
      if (!ru || ru.pointsPerWeapon == null) return;
      var mref = ru.modifierRef ? ru.modifierRef.split(':')[1] : null;
      total += _modifierMarginalCost(p[4], mref, ru.pointsPerWeapon);
    });
    return total;
  }

  // ── Statline-banded wargear pricing ─────────────────────────────────────────
  // An item whose model rows are banded has no flat cost — its prose pointsCost is
  // "varies" and the option row's `points` is null — because each band carries its own
  // per-model cost (Adrenal Glands: 5 pts on a T3 model, 15 on a T4+ one). What it
  // costs therefore depends on WHICH model takes it.
  function _bandedRows(o) {
    var m = _optMechanics(o); if (!m) return null;
    var rows = (m.rows || []).filter(function (r) {
      return (r.target || {}).domain === 'model' && _rowBand(r);
    });
    return rows.length ? rows : null;
  }
  function isBandedOption(o) { return !!o && o.points == null && !!_bandedRows(o); }
  // The banded row covering a model type, or null when none does (a band gap).
  function _bandedRowFor(o, mt) {
    var rows = _bandedRows(o); if (!rows) return null;
    var stats = (mt && mt.stats) || {};
    for (var i = 0; i < rows.length; i++) {
      var b = _rowBand(rows[i]);
      if (_bandMatch(b, stats[b.char])) return rows[i];
    }
    return null;
  }
  // Per-model cost of a banded item on one model type (0 when no band covers it).
  function bandedCost(o, mt) {
    var p = (_bandedRowFor(o, mt) || {}).points;
    return (p && p.op === 'delta') ? p.value : 0;
  }
  // The composition model type(s) a clause's selections can land on: the type it names
  // (scope.modelType), else every type currently in the unit.
  function _clauseModelTypes(entry, u, cl) {
    var types = modelTypes(u);
    if (types.length <= 1) return types;
    var nm = cl && cl.scope && cl.scope.modelType;
    if (nm) {
      var n = _normModelName(nm);
      for (var i = 0; i < types.length; i++) if (_normModelName(types[i].name) === n) return [types[i]];
    }
    var present = types.filter(function (mt) { return (entry.modelCounts[mt.name] || 0) > 0; });
    return present.length ? present : types;
  }
  // Every model of every targeted type carries the item (so it can be priced per type),
  // rather than an opaque count of models having taken it.
  function _everyModel(cl) { return cl.op === 'fixed' || !!(cl.scope && cl.scope.who === 'unit'); }
  // Can any model in the clause's scope take this item? False only for a banded item
  // whose bands leave every targeted model type in a gap.
  function bandTakeable(entry, u, cl, o) {
    if (!isBandedOption(o)) return true;
    return _clauseModelTypes(entry, u, cl).some(function (mt) { return !!_bandedRowFor(o, mt); });
  }
  // Points contributed by one selected option. `mult` is the instance count a flat cost
  // would have been multiplied by (per-model count, or every model for who:unit).
  function _optCost(entry, u, cl, o, mult) {
    if (!isBandedOption(o)) return (o.points || 0) * mult;
    var types = _clauseModelTypes(entry, u, cl);
    if (types.length === 1) return bandedCost(o, types[0]) * mult;
    if (_everyModel(cl)) {                 // known per type → sum the real per-type costs
      var t = 0;
      types.forEach(function (mt) { t += bandedCost(o, mt) * (entry.modelCounts[mt.name] || 0); });
      return t;
    }
    // Ambiguous: a per-model clause records only a COUNT, not which models took it, so on
    // a mixed unit the tier can't be known. Charge the dearest matching tier — never
    // undercharge. convert_options.py warns on this so the source can be made explicit.
    var max = 0;
    types.forEach(function (mt) { max = Math.max(max, bandedCost(o, mt)); });
    return max * mult;
  }
  // Per-model points to display on an option row: its flat cost, the band-resolved cost,
  // or null ("see rules") when no single per-model number is honest — an unpriced item,
  // or a banded item on a mixed unit where every model pays its own tier.
  function optDisplayPoints(entry, u, cl, o) {
    if (!isBandedOption(o)) return (o && o.points != null) ? o.points : null;
    var costs = _clauseModelTypes(entry, u, cl).map(function (mt) { return bandedCost(o, mt); });
    if (!costs.length) return null;
    if (costs.every(function (c) { return c === costs[0]; })) return costs[0];
    return _everyModel(cl) ? null : Math.max.apply(null, costs);   // else: what _optCost bills
  }

  // ── Unit traversal (points and loadout share one walk) ───────────────────────
  // Every contributor to a unit's cost is emitted here exactly once. calcUnitPoints
  // sums the records; unitLoadout displays them. Because both read the same walk,
  // the exported roster can never quietly disagree with the builder's total, and
  // anything that costs points is guaranteed to appear as a line on the roster.
  //
  // A record is { g, name, qty, kind, mods, points, src, target, note }:
  //   g       display group — models | standard | wargear | upgrades | characteristics | adjust
  //   qty     how many models/instances carry it (negative = a weapon given up)
  //   points  this record's exact contribution to the unit total (already × qty)
  //   src     identity of the selection that produced it, so an upgrade can find it
  //   target  for an upgrade record, the `src` of the item it decorates
  // 'adjust' records carry points but are never displayed (refunds, trait deltas).

  function _modDisplayName(id) {
    var fw = (_data.factionWargear && _data.factionWargear.wargearItems) || [];
    for (var i = 0; i < fw.length; i++) if (fw[i].itemId === id) return fw[i].name;
    return id;
  }
  // Text of a composite option that carries no refs at all (connectors only).
  function _optText(o) {
    if (!o) return '';
    if (o.name) return o.name;
    return (o.parts || []).map(function (p) { return p.text != null ? p.text : (p.name || ''); })
                          .join('').trim();
  }
  // The displayable components of an option. A composite ("Bolt Pistol and Chainsword")
  // lists each referenced item separately, which is what a roster wants.
  function _optParts(o) {
    var parts = (o && o.parts && o.parts.length)
      ? o.parts.filter(function (p) { return p.ref; }) : null;
    if (!parts || !parts.length) parts = (o && o.ref) ? [o] : [];
    return parts;
  }
  // The merge key of the line an option produces, so anything the option carries with
  // it (a combi-weapon's chosen sub-weapon, a mount's included weapon) can be nested
  // under it rather than floating loose among the unit's other wargear.
  function _optIdentity(o) {
    var p = _optParts(o)[0];
    if (!p) return null;
    return 'item|' + String(p.name || p.ref).toLowerCase() + '|' +
           (p.modifiers || []).map(_modDisplayName).join('+');
  }

  // The whole option's cost rides on its first component so the sum is untouched.
  function _emitOption(emit, g, o, mult, points, extra) {
    var parts = _optParts(o);
    if (!parts.length) {
      emit(_rec(g, _optText(o) || '—', mult, (o || {}).kind, [], points, extra));
      return;
    }
    parts.forEach(function (p, i) {
      var e = { ref: p.ref, modRefs: (p.modifiers || []).slice() };
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      emit(_rec(g, p.name || p.ref, (p.qty || 1) * mult, p.kind,
                (p.modifiers || []).map(_modDisplayName), i === 0 ? points : 0, e));
    });
  }
  // `ref`/`modRefs` are carried so a rendered roster can key the site's weapon and
  // wargear tooltips off the same slugs the faction pages use.
  function _rec(g, name, qty, kind, mods, points, extra) {
    var r = { g: g, name: name, qty: qty, kind: kind || null, mods: mods || [],
              points: points || 0, ref: null, modRefs: [] };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  function _walkUnit(entry, emit) {
    var u = getUnitData(entry.unitName);
    if (!u) return null;
    var N = totalModels(entry);

    modelTypes(u).forEach(function (mt) {
      var c = entry.modelCounts[mt.name] || 0;
      emit(_rec('models', mt.name, c, 'model', [], c * (mt.basePoints || 0)));
    });

    clauses(u, entry).forEach(function (cl) {
      var sel = entry.sel[cl.id] || {};
      if (cl.op === 'fixed') {
        // option.points already includes the Nx quantity (baked in at parse time).
        // A model/role-scoped fixed clause bills only its model type's count.
        var fN = _fixedN(entry, cl);
        (cl.options || []).forEach(function (o) {
          _emitOption(emit, 'standard', o, fN, _optCost(entry, u, cl, o, fN),
                      { src: cl.id + '::' + o.ref });
        });
        return;
      }
      if (cl.op === 'modifier') {
        if (cl.appliesTo) {
          Object.keys(sel).forEach(function (ref) {
            var o = findOpt(cl, ref); if (!o) return;
            _emitOption(emit, 'upgrades', o, sel[ref] || 0, (o.points || 0) * (sel[ref] || 0),
                        { src: cl.id + '::' + o.ref });
          });
        }
        // else: "any equipped weapon → Relic Weapon" — points come from entry.relic (below)
        return;
      }
      // choose / add / replace
      var repl = (cl.op === 'replace') ? _replacedCost(cl.replaces) : 0;
      var pmax = (cl.pick && cl.pick.max) || 1;
      var clauseSel = 0;   // total option instances chosen across this clause
      Object.keys(sel).forEach(function (ref) {
        var cnt = sel[ref] || 0; if (!cnt) return;
        var o = findOpt(cl, ref); if (!o) return;
        var mult = (cl.scope && cl.scope.who === 'unit') ? N : cnt;
        _emitOption(emit, 'wargear', o, mult, _optCost(entry, u, cl, o, mult),
                    { src: cl.id + '::' + o.ref });
        clauseSel += mult;
        // sub-selection cost (combi sub-weapon, warsuit/turret/sponson weapons).
        // Already per-instance/×count internally — not multiplied by `mult` again.
        if (itemSubSelections(o.ref)) _walkSubSelections(entry, u, cl, o, emit);
        // auto-included weapons (Wings → Wing Barbs), cost added on top of the item.
        if (itemIncludedWeapons(o.ref)) _walkIncludedWeapons(entry, u, cl, o, emit);
      });
      // Weapon-named replace refunds the replaced weapon's cost once per REPLACING
      // MODEL, not per option instance. A model that replaces takes pick.max items, so
      // the number of models that gave up the named weapon is (selections ÷ pick.max):
      // for pick.max===1 this is the old "once per selection", and for a "replace with
      // N" clause (e.g. Lychguard Warscythe → 2 items) it stops the refund being taken
      // N× per model. Assumes each replacing model takes exactly pick.max items.
      // Negative quantities against the named item, so the roster shows the models that
      // KEPT it rather than the unit's original full complement. Emitted whenever the
      // clause names what it displaces — including a slot replace that also names an
      // item (armour), where the slot pool means there is no refund but the item is
      // still given up. Points ride on `repl`, which is 0 in exactly those cases, so
      // netting the display can never move the total.
      var models = Math.round(clauseSel / pmax);
      if (models > 0) {
        _replacedNames(cl.replaces).forEach(function (nm, i) {
          emit(_rec('standard', nm, -models, null, [], i === 0 ? -repl * models : 0));
        });
      }
    });

    // Relic Weapon upgrades, per weapon instance marked relic. Priced by resolving the
    // weapon with and without the modifier rather than by a flat pointsPerWeapon, so an
    // upgrade that re-tiers an existing Twin-linked surcharge bills the real difference.
    var rc = relicModifier(u);
    if (rc && entry.relic) {
      var per = rc.pointsPerWeapon || 0;
      var mref = rc.modifierRef ? rc.modifierRef.split(':')[1] : null;
      var rname = rc.modifier || (mref ? _modDisplayName(mref) : 'Relic Weapon');
      Object.keys(entry.relic).forEach(function (k) {
        var optRef = k.slice(k.indexOf('::') + 2), n = entry.relic[k] || 0;
        emit(_rec('upgrades', rname, n, 'upgrade', [],
                  _modifierMarginalCost(optRef, mref, per) * n,
                  { target: k, modName: rname, modRef: mref }));
      });
    }
    // Sub-selection relic upgrades (item.relicUpgrade on Paragon weapons, etc.).
    if (entry.subRelic) {
      Object.keys(entry.subRelic).forEach(function (key) {
        var p = key.split('::');                 // clauseId::optRef::modelIdx::groupId::subRef
        var ru = itemRelicUpgrade(p[1]);
        if (!ru || ru.pointsPerWeapon == null) return;
        var mref2 = ru.modifierRef ? ru.modifierRef.split(':')[1] : null;
        var rn = ru.modifier || (mref2 ? _modDisplayName(mref2) : 'Relic Weapon');
        emit(_rec('upgrades', rn, 1, 'upgrade', [],
                  _modifierMarginalCost(p[4], mref2, ru.pointsPerWeapon),
                  { target: key, modName: rn, modRef: mref2 }));
      });
    }
    // Standard weapons replaced by a sub-selection ("…replace its Bolt Pistol with…").
    var rsw = replacedStandardWeapons(entry, u);
    Object.keys(rsw).forEach(function (nm) {
      emit(_rec('standard', _displayWeaponName(nm), -rsw[nm], 'weapon', [], -_weaponCost(nm) * rsw[nm]));
    });

    // Active detachment-trait points deltas for a matching unit (R4). None in AA,
    // but supported so a trait that repoints a unit reflects in its total.
    var nameLower = (u.name || '').toLowerCase();
    _activeTraits().forEach(function (t) {
      ((t.mechanics && t.mechanics.rows) || []).forEach(function (row) {
        if (!row.target || row.target.domain !== 'unit' || !row.points || row.points.op !== 'delta') return;
        var match = modelTypes(u).some(function (mt) {
          return _matchElig(row.target.eligibility, _armourKeywords(entry, mt).map(function (x) { return x.toLowerCase(); }), nameLower);
        });
        if (match) emit(_rec('adjust', t.name || 'Detachment Trait', 1, null, [], row.points.value));
      });
    });

    // Selectable-catalog gifts (Gifts of Chaos) — per-model priced by tier.
    unitAllowances(u).forEach(function (a) {
      var mt = _mtByName(u, a.modelType), c = entry.modelCounts[a.modelType] || 0;
      if (a.scope === 'model') {
        var byIdx = (entry.gifts || {})[allowanceKey(a)] || {};
        Object.keys(byIdx).forEach(function (idx) {
          (byIdx[idx] || []).forEach(function (id) {
            var t = giftTier(catalogItem(id), mt);
            emit(_rec('upgrades', (catalogItem(id) || {}).name || id, 1, 'upgrade', [], t ? t.points : 0));
          });
        });
      } else {
        var mult = (a.scope === 'champion') ? 1 : c;   // unit = every model of type; champion = 1
        giftSelection(entry, a).forEach(function (id) {
          var t2 = giftTier(catalogItem(id), mt);
          emit(_rec('upgrades', (catalogItem(id) || {}).name || id, mult, 'upgrade', [],
                    t2 ? t2.points * mult : 0));
        });
      }
    });

    // Key characteristics: a selected profile's wargear is already billed above (its
    // clauses are live), so only an authored flat `points` is added here. A profile
    // with no flat cost is still listed — it names the build the roster represents.
    keyCharInline(u).forEach(function (sec) {
      keyCharSelection(entry, sec.id).forEach(function (pid) {
        var pr = (sec.profiles || []).filter(function (p) { return p.id === pid; })[0];
        if (!pr) return;
        emit(_rec('characteristics', pr.name || pr.id, 1, 'profile', [],
                  pr.points != null ? pr.points : 0, { section: sec.name || sec.id }));
      });
    });
    return u;
  }

  // The item name(s) a replace clause takes away, for the roster's netting. A slot
  // replace that names no item ({slot:'primary-ranged'}) yields nothing: the slot pool
  // already stops the standard weapon being counted on a model that replaced it.
  function _replacedNames(replaces) {
    if (!replaces) return [];
    if (replaces.weapons) return replaces.weapons.map(_displayWeaponName);
    if (replaces.weapon) return [_displayWeaponName(replaces.weapon)];
    return [];
  }
  // Canonical casing for a weapon named in prose ("bolt pistol" → "Bolt Pistol"), so a
  // negative netting record matches the positive one emitted from option data.
  function _displayWeaponName(name) {
    var n = String(name == null ? '' : name).trim();
    var bare = n.replace(/^\d+\s*x?\s+/i, '');
    var weapons = (_data.units && _data.units.weapons) || [];
    for (var i = 0; i < weapons.length; i++)
      if ((weapons[i].name || '').trim().toLowerCase() === bare.toLowerCase()) return weapons[i].name;
    var fw = (_data.factionWargear && _data.factionWargear.wargearItems) || [];
    for (var j = 0; j < fw.length; j++)
      if ((fw[j].name || '').trim().toLowerCase() === bare.toLowerCase()) return fw[j].name;
    return bare;
  }

  // Sub-selection picks, mirroring subSelectionCost's per-instance arithmetic. Emitted
  // as children of the item that offers them, so a Combi-Bolter's chosen Meltagun reads
  // as part of the Combi-Bolter rather than as a separate weapon the model also carries.
  function _walkSubSelections(entry, u, cl, o, emit) {
    var optRef = o.ref;
    var subs = itemSubSelections(optRef); if (!subs) return;
    var byModel = (entry.nested && entry.nested[nestedKey(cl.id, optRef)]) || {};
    var inst = itemInstances(optRef);
    var parent = _optIdentity(o);
    function emitPicks(picks, mult, modelIdx) {
      Object.keys(picks || {}).forEach(function (gid) {
        (picks[gid] || []).forEach(function (r) {
          var g = _subGroup(subs, gid);
          var so = g && (g.options || []).filter(function (x) { return x.ref === r; })[0];
          _emitOption(emit, 'wargear', so || { ref: r, name: r }, mult,
                      _subOptPoints(subs, gid, r) * mult,
                      { src: cl.id + '::' + optRef + '::' + modelIdx + '::' + gid + '::' + r,
                        parent: parent });
        });
      });
    }
    if (inst) { emitPicks(byModel['0'], instanceCountFor(entry, cl.id, optRef), '0'); return; }
    var k = equippedInstances(entry, u, cl, optRef);
    for (var i = 0; i < k; i++) emitPicks(byModel[i], 1, i);
  }
  // Weapons that come free with an item (Dozer Blade Mount → Dozer Blade, Wings → Wing
  // Barbs), priced on top of it and nested under it. The weapon's own ref is carried so
  // the roster can hang the site's weapon tooltip off it like any other weapon line.
  function _walkIncludedWeapons(entry, u, cl, o, emit) {
    var optRef = o.ref;
    var inc = itemIncludedWeapons(optRef); if (!inc || !inc.length) return;
    var mult = itemInstances(optRef) ? instanceCountFor(entry, cl.id, optRef)
                                     : equippedInstances(entry, u, cl, optRef);
    var parent = _optIdentity(o);
    inc.forEach(function (w) {
      _emitOption(emit, 'wargear', w, mult, (w.points || 0) * mult, { parent: parent });
    });
  }

  // ── Points ───────────────────────────────────────────────────────────────────
  function calcUnitPoints(entry) {
    var total = 0;
    // `|| 0` contains a non-numeric datum (a malformed row whose basePoints is text)
    // to the one record that carries it, instead of letting NaN poison the army total.
    var u = _walkUnit(entry, function (r) { total += r.points || 0; });
    if (!u) { entry.computedPoints = 0; return 0; }
    entry.computedPoints = Math.max(0, Math.round(total));
    return entry.computedPoints;
  }

  function calcTotalPoints() {
    return _state.selectedUnits.reduce(function (s, u) { return s + calcUnitPoints(u); }, 0);
  }

  // ── Loadout summary (export view, share links, clipboard) ────────────────────
  // A read-only projection of a unit built from the same walk that prices it, so a
  // roster can be rendered without re-deriving any of the selection semantics.

  // Netting namespace: an item is the same item whether it arrived as compulsory
  // Standard Wargear or as a chosen option, so a "replace its Bolt Pistol" refund
  // cancels the Bolt Pistol line wherever that line came from.
  function _recKey(r) {
    var ns = (r.g === 'standard' || r.g === 'wargear') ? 'item' : r.g;
    // Children are keyed under their parent so two Combi-Bolters carrying different
    // sub-weapons don't collapse into one line, while two carrying the same one do.
    var parent = r.parent ? '<' + r.parent : '';
    return ns + '|' + String(r.name).toLowerCase() + '|' + (r.mods || []).join('+') + parent;
  }
  // Move upgraded instances onto their own line: 2 of 5 Power Fists marked Relic
  // Weapon reads as "3x Power Fist" + "2x Power Fist (Relic Weapon)". Quantities
  // move; points do not, so how the roster is presented cannot shift the total.
  function _splitUpgrades(recs) {
    var out = recs.slice();
    recs.forEach(function (up) {
      if (up.g !== 'upgrades' || !up.target) return;
      var base = null;
      for (var i = 0; i < out.length; i++) {
        var r = out[i];
        if (r === up || r.src !== up.target) continue;
        if (r.g !== 'standard' && r.g !== 'wargear') continue;
        if (r.qty > 0) { base = r; break; }
      }
      if (!base) return;                  // nothing to decorate — the upgrade stands alone
      var n = Math.min(up.qty || 0, base.qty);
      if (n <= 0) return;
      base.qty -= n;
      out.push(_rec(base.g, base.name, n, base.kind,
                    (base.mods || []).concat([up.modName || up.name]), 0,
                    { ref: base.ref,
                      modRefs: (base.modRefs || []).concat(up.modRef ? [up.modRef] : []) }));
      up.g = 'adjust';                    // now represented by the decorated line
    });
    return out;
  }
  function _mergeRecords(recs) {
    var out = [], idx = {};
    recs.forEach(function (r) {
      var k = _recKey(r), at = idx[k];
      if (at === undefined) {
        idx[k] = out.length;
        out.push(_rec(r.g, r.name, r.qty, r.kind, r.mods, r.points,
                      { section: r.section, ref: r.ref, modRefs: r.modRefs, parent: r.parent }));
      } else {
        var t = out[at];
        t.qty += r.qty; t.points += r.points;
        // a negative-only bucket keeps the group it was emitted with; otherwise the
        // first positive contributor decides where the merged line is displayed
        if (t.qty > 0 && r.qty > 0 && t.g === 'standard' && r.g === 'wargear') t.g = 'wargear';
      }
    });
    return out;
  }

  var ITEM_GROUP_ORDER = { characteristics: 0, standard: 1, wargear: 2, upgrades: 3 };

  // Prose sections worth carrying onto a roster: the rules a player needs at the table
  // that aren't already implied by the selections listed above them. Everything else
  // (composition, standard wargear, wargear/armour options, force organisation) only
  // tells the reader what COULD have been chosen, which the roster answers directly.
  var RULES_SECTIONS = {
    specialAbilities: 'Special Abilities',
    leader: 'Leader',
    additionalRules: 'Additional Rules',
  };

  // Rules text for the key-characteristic choice a unit made — the selected profile or
  // catalog items only. The section's own prose is the menu ("select up to 4 of the
  // following"), which is noise once the choice is made.
  function _keyCharRules(entry, u, sec) {
    var blocks = [];
    if (sec.source === 'catalog') {
      var ids = sec.itemIds || null;
      _selectedGiftIds(entry, u).forEach(function (id) {
        if (ids && ids.indexOf(id) === -1) return;      // belongs to a different section
        var it = catalogItem(id); if (!it) return;
        blocks.push({ name: it.name, html: it.effectsHtml || '', effects: (it.effects || []).slice() });
      });
    } else {
      keyCharSelection(entry, sec.id).forEach(function (pid) {
        var pr = (sec.profiles || []).filter(function (p) { return p.id === pid; })[0];
        if (!pr) return;
        var html = [pr.abilities || '', pr.leader || ''].filter(Boolean).join('\n');
        blocks.push({ name: pr.name || pr.id, html: html });
      });
    }
    if (!blocks.length) return null;
    return { key: 'keyCharacteristic', label: sec.label || 'Key Characteristic', blocks: blocks };
  }
  // Every catalog item selected on the unit, across all its allowances, in order.
  function _selectedGiftIds(entry, u) {
    var out = [], seen = {};
    var push = function (id) { if (!seen[id]) { seen[id] = 1; out.push(id); } };
    unitAllowances(u).forEach(function (a) {
      var g = (entry.gifts || {})[allowanceKey(a)];
      if (!g) return;
      if (a.scope === 'model') Object.keys(g).forEach(function (idx) { (g[idx] || []).forEach(push); });
      else (g || []).forEach(push);
    });
    return out;
  }

  function _unitRules(entry, u) {
    var out = [];
    (unitOptions(u).sections || []).forEach(function (s) {
      if (s.key === SEC_KEYCHAR) {
        var kc = _keyCharRules(entry, u, s); if (kc) out.push(kc);
        return;
      }
      if (!RULES_SECTIONS[s.key]) return;
      var html = String(s.prose || '').trim();
      if (html) out.push({ key: s.key, label: RULES_SECTIONS[s.key], html: html });
    });
    return out;
  }

  // Resolved statline per model type actually present, so armour swaps, gifts and
  // detachment traits are reflected rather than the unmodified book values.
  function _unitStatlines(entry, u) {
    var out = [];
    modelTypes(u).forEach(function (mt) {
      var qty = entry.modelCounts[mt.name] || 0;
      if (qty <= 0) return;
      out.push({ modelType: mt.name, qty: qty, stats: resolvedStats(entry, mt), base: mt.stats || {},
                 partial: partialModelEffects(entry, mt) });
    });
    if (!out.length) {                       // a unit with no models still shows its profile
      var mt0 = modelTypes(u)[0];
      if (mt0) out.push({ modelType: mt0.name, qty: 0, stats: resolvedStats(entry, mt0), base: mt0.stats || {},
                          partial: [] });
    }
    return out;
  }
  // Union of the resolved keywords across the model types present, in first-seen order.
  function _unitKeywords(entry, u) {
    var seen = {}, out = [];
    var types = modelTypes(u).filter(function (mt) { return (entry.modelCounts[mt.name] || 0) > 0; });
    if (!types.length) types = modelTypes(u).slice(0, 1);
    types.forEach(function (mt) {
      (resolvedKeywords(entry, mt) || []).forEach(function (k) {
        var lk = String(k).toLowerCase();
        if (!seen[lk]) { seen[lk] = 1; out.push(k); }
      });
    });
    return out.length ? out : ((u && u.keywords) || []).slice();
  }

  function unitLoadout(entry) {
    var recs = [];
    var u = _walkUnit(entry, function (r) { recs.push(r); });
    var recordTotal = recs.reduce(function (s, r) { return s + (r.points || 0); }, 0);
    var merged = _mergeRecords(_splitUpgrades(recs));

    var models = [], flat = [], characteristics = [];
    merged.forEach(function (r) {
      if (r.g === 'adjust') return;
      if (r.g === 'models') { if (r.qty > 0) models.push({ name: r.name, qty: r.qty, points: r.points }); return; }
      if (r.qty <= 0) return;             // fully replaced / given up
      if (r.g === 'characteristics') characteristics.push({ section: r.section || '', name: r.name });
      flat.push({ name: r.name, qty: r.qty, kind: r.kind, mods: r.mods || [], group: r.g,
                  ref: r.ref || null, modRefs: r.modRefs || [], parent: r.parent || null,
                  key: _recKey(r), children: [] });
    });
    flat.sort(function (a, b) { return (ITEM_GROUP_ORDER[a.group] || 9) - (ITEM_GROUP_ORDER[b.group] || 9); });

    // Hang each carried item under the line that carries it. If its parent line is gone
    // — every copy was upgraded onto a modified line, say — fall back to matching on
    // name alone, and only then let it stand on its own.
    var byKey = {}, byName = {};
    flat.forEach(function (i) {
      if (i.parent) return;                                  // a child is never a parent here
      byKey[i.key] = i;
      var n = i.name.toLowerCase();
      if (!byName[n]) byName[n] = i;
    });
    var items = [];
    flat.forEach(function (i) {
      if (!i.parent) { items.push(i); return; }
      var host = byKey[i.parent] || byName[String(i.parent).split('|')[1] || ''];
      if (host) host.children.push(i); else items.push(i);
    });

    var pts = Math.max(0, Math.round(recordTotal));
    return {
      id: entry.id,
      unitName: entry.unitName,
      category: (u && u.category) || 'Other',
      keywords: u ? _unitKeywords(entry, u) : [],
      orgKeywords: u ? _orgKeywords(u) : [],
      statlines: u ? _unitStatlines(entry, u) : [],
      rules: u ? _unitRules(entry, u) : [],
      points: pts,
      isWarlord: !!entry.isWarlord,
      squadronHost: !!entry.squadronHost,
      totalModels: totalModels(entry),
      modelCounts: entry.modelCounts || {},
      models: models,
      items: items,          // tree: top-level lines, each with .children
      flatItems: flat,       // every line, ignoring nesting (Markdown, tests)
      characteristics: characteristics,
      issues: unitIssues(entry),
      // accounting set + invariant, for the reconciliation harness
      records: merged,
      recordTotal: pts,
    };
  }

  // ── Markdown roster (clipboard) ──────────────────────────────────────────────
  function _fmtPts(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // Escape the characters that would otherwise style the roster when pasted.
  function _mdEsc(s) { return String(s == null ? '' : s).replace(/([*_`[\]])/g, '\\$1'); }
  // Items a piece of wargear carries with it are indented under it, so a Combi-Bolter's
  // chosen sub-weapon reads as part of it rather than as a separate weapon.
  function _itemLines(i, depth, out) {
    var mods = (i.mods && i.mods.length) ? ' (' + i.mods.map(_mdEsc).join(', ') + ')' : '';
    out.push(new Array((depth || 0) * 2 + 1).join(' ') + '- ' + i.qty + 'x ' + _mdEsc(i.name) + mods);
    (i.children || []).forEach(function (c) { _itemLines(c, (depth || 0) + 1, out); });
    return out;
  }

  function toMarkdown() {
    var s = listSummary(), out = [];
    out.push('# ' + _mdEsc(s.listName || 'Untitled List'));
    out.push('**' + _mdEsc(s.factionTitle || s.faction || 'Unknown faction') + '** — ' +
             _fmtPts(s.totalPoints) + ' / ' + _fmtPts(s.targetPoints) + ' pts');

    if (s.detachment.traits.length) {
      out.push('');
      var dp = s.detachment.budget != null
        ? ' (' + s.detachment.spent + ' / ' + s.detachment.budget + ' DP)' : '';
      out.push('**Detachment Traits**' + dp + ': ' +
               s.detachment.traits.map(function (t) {
                 // Name the sub-selection here too, or the pasted list loses it.
                 return _mdEsc(t.name) + ((t.picks || []).length ? ' (' + _mdEsc(t.picks.join(', ')) + ')' : '');
               }).join(', '));
    }

    s.categories.forEach(function (cat) {
      out.push('');
      out.push('## ' + _mdEsc(cat.name));
      cat.units.forEach(function (l) {
        out.push('');
        var models = l.totalModels > 1 ? ' (' + l.totalModels + ' models)' : '';
        out.push('**' + _mdEsc(l.unitName) + '**' + models +
                 (l.isWarlord ? ' *[Warlord]*' : '') + ' — ' + _fmtPts(l.points) + ' pts');
        if (l.models.length > 1) {
          out.push('- ' + l.models.map(function (m) { return m.qty + 'x ' + _mdEsc(m.name); }).join(', '));
        }
        l.characteristics.forEach(function (c) {
          out.push('- *' + _mdEsc(c.section || 'Characteristic') + ':* ' + _mdEsc(c.name));
        });
        l.items.forEach(function (i) { if (i.group !== 'characteristics') _itemLines(i, 0, out); });
      });
    });

    // Army-wide problems plus units with choices still outstanding — the same test
    // the export view applies, so a pasted list carries the same caveats as the page.
    var problems = s.forceOrg.violations.concat(s.detachment.violations);
    s.units.forEach(function (l) {
      if (l.issues && l.issues.length) problems.push(l.unitName + ': ' + l.issues[0]);
    });
    if (problems.length) {
      out.push('');
      out.push('> **This list is not yet complete:**');
      problems.forEach(function (p) { out.push('> - ' + _mdEsc(p)); });
    }
    return out.join('\n');
  }

  // Display order for unit categories, shared by the builder, the export view and
  // the clipboard writer so a roster always groups the same way.
  var CAT_ORDER = ['Character', 'Epic Heroes', 'Battleline', 'Infantry', 'Mounted', 'Walkers',
                   'Vehicles', 'Titanic', 'Dedicated Transports', 'Dedicated Transport', 'Fortifications'];
  function categoryOrder(obj) {
    return CAT_ORDER.filter(function (c) { return obj[c]; })
      .concat(Object.keys(obj).filter(function (c) { return CAT_ORDER.indexOf(c) === -1; }).sort());
  }

  // The faction's display name. The loaded unit data carries it, which matters for the
  // export view: that page renders from a share link and never builds the faction
  // picker, so it has no `_data.factions` to look the title up in.
  // Statline column order, shared by the builder's options panel and the roster.
  // Matches the Unit Profiles tables on the faction pages, Activation Points first.
  var STAT_KEYS = ['AP', 'M', 'WS', 'BS', 'I', 'A', 'S', 'T', 'W', 'SV', 'LD'];
  // Column headings. Only AP differs from its key: on a model statline AP is Activation
  // Points, but on a weapon profile it is Armour Piercing, so the model column is
  // spelled out the way the faction pages spell it.
  var STAT_LABELS = { AP: 'Act.Pts.' };
  function statLabel(k) { return STAT_LABELS[k] || k; }

  // ── Weapon profiles (roster appendix) ────────────────────────────────────────
  // Tooltips carry weapon stats on screen but not onto paper, so a printed roster
  // needs the profiles somewhere. One deduplicated table per army is enough: a weapon
  // carried by four units is still one weapon. Modifiers are part of the identity —
  // a Twin-linked Boltgun is a different profile from a Boltgun.
  function weaponProfiles(ref, modRefs) {
    var w = _weaponByRef(ref); if (!w) return null;
    var mods = (modRefs || []).concat(_modsFromRef(ref));
    var reg = _modRegistry();
    var res = (reg && window.AH_WMOD) ? window.AH_WMOD.resolve(w, mods, reg) : null;
    var profiles = res ? res.profiles : [{
      profileName: null, range: w.range, attacks: w.attacks, strength: w.strength,
      ap: w.ap, damage: w.damage, keywords: (w.keywords || []).slice(),
    }];
    return { section: w.section || '', profiles: profiles };
  }

  // Every distinct weapon in the list, deduplicated across units and ordered by the
  // section the source document groups them under (Ranged before Melee), then by name.
  function weaponAppendix(loadouts) {
    var seen = {}, out = [];
    loadouts.forEach(function (l) {
      (l.flatItems || []).forEach(function (i) {
        if (i.kind !== 'weapon' || !i.ref) return;
        var key = String(i.ref).toLowerCase() + '|' + (i.mods || []).join('+');
        if (seen[key]) return;
        var wp = weaponProfiles(i.ref, i.modRefs); if (!wp) return;
        seen[key] = 1;
        out.push({ name: i.name, mods: (i.mods || []).slice(), ref: i.ref,
                   section: wp.section, profiles: wp.profiles });
      });
    });
    var rank = function (s) { return /melee/i.test(s || '') ? 1 : 0; };
    return out.sort(function (a, b) {
      return rank(a.section) - rank(b.section) || a.name.localeCompare(b.name);
    });
  }

  function _factionTitle(slug) {
    if (_data.units && _data.units.faction) return _data.units.faction;
    for (var i = 0; i < (_data.factions || []).length; i++)
      if (_data.factions[i].slug === slug) return _data.factions[i].title;
    if (!slug) return '';
    return String(slug).split('-').map(function (w) {   // last resort: de-slug
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // The whole list, ready to render: grouped by category, with detachment traits and
  // validation folded in. The single input to the export view and the Markdown writer.
  function listSummary() {
    var units = _state.selectedUnits.map(unitLoadout);
    var byCat = {};
    units.forEach(function (l) { (byCat[l.category] = byCat[l.category] || []).push(l); });
    var vd = validateDetachment(), vf = validateForceOrg();
    var traits = _state.detachmentTraitsSelected.map(_traitById).filter(Boolean).map(function (t) {
      // A trait's sub-selection is part of what the player chose, so the roster has to
      // name it — "Aspect Host" alone doesn't say which unit became Battleline.
      var picks = [];
      traitChoices(t).forEach(function (c) {
        traitChoice(t.traitId, c.choiceId).forEach(function (opt) {
          var o = c.options.filter(function (x) { return x.optionId === opt; })[0];
          if (o) picks.push(o.label);
        });
      });
      // The roster is played from, so it carries the trait's whole rule, not just its
      // name. `choices` rides along so the renderer can drop the options NOT taken —
      // the one that was is already named beside the title.
      return { name: t.name, cost: t.detachmentPointsCost, category: t.category || '',
               picks: picks, html: t.effectsHtml || '', effects: (t.effects || []).slice(),
               choices: traitChoices(t) };
    });
    return {
      listName: _state.listName || '',
      faction: _state.faction,
      factionTitle: _factionTitle(_state.faction),
      targetPoints: _state.targetPoints,
      totalPoints: units.reduce(function (s, l) { return s + l.points; }, 0),
      detachment: { spent: vd.spent, budget: vd.budget, traits: traits, violations: vd.violations },
      forceOrg: { violations: vf.violations, warnings: vf.warnings },
      categories: categoryOrder(byCat).map(function (c) {
        return {
          name: c, units: byCat[c],
          points: byCat[c].reduce(function (s, l) { return s + l.points; }, 0),
        };
      }),
      units: units,
      weapons: weaponAppendix(units),
    };
  }

  // ── Force-org validation ─────────────────────────────────────────────────────
  var BATTLE_SIZES = [
    { id: 'patrol', label: 'Patrol', points: 500 },
    { id: 'combat', label: 'Combat', points: 1000 },
    { id: 'strike-force', label: 'Strike Force', points: 1500 },
    { id: 'onslaught', label: 'Onslaught', points: 2000 },
  ];

  function _kw(ud) { return (ud.keywords || []).map(function (k) { return k.toLowerCase(); }); }

  // "N of the same unit for every P points" — the shape every points-scaled force-org
  // cap takes, general or unit-specific. The floor at N is the point: a cap written per
  // 1,000 points does NOT mean the army must reach 1,000 points, it means one unit per
  // 1,000-point block, and a 500-pt game still gets its first block. Battle-size minimums
  // are a separate rule and Titanic is the only keyword that sets one.
  //   1 per 1,000 →  500:1   1,000:1   1,500:1   2,000:2
  //   1 per   500 →  500:1   1,000:2   1,500:3   2,000:4
  function _perPoints(n, per, pts) { return Math.max(n, Math.floor(pts / per) * n); }

  // Models with any of these can never embark in a Transport (Keywords & Abilities —
  // Transport [X]). Note Character is absent: a Captain rides in a Rhino.
  var NO_EMBARK = ['fly', 'jump pack', 'hover', 'mounted', 'vehicle', 'walker', 'beast'];

  // The lowest Toughness on any of a unit's model types. Unknown → 0, so missing data
  // never disqualifies a unit from a rule that keys off Toughness.
  function _minToughness(ud) {
    var ts = [];
    (ud.models || []).forEach(function (m) { ts.push(parseInt((m.stats || {}).T, 10)); });
    if (!ts.length) ts.push(parseInt((ud.stats || {}).T, 10));
    ts = ts.filter(function (n) { return !isNaN(n); });
    return ts.length ? Math.min.apply(null, ts) : 0;
  }

  // A unit's force-org rule has two possible sources. `ud.forceOrg` is the workbook's
  // Force Org Constraints column — structured, resolved at build time, authoritative.
  // `options.forceOrg` is derived from the Faction Index prose by regex; it is the
  // fallback for factions that have not adopted the column yet, and it remains the
  // only source of `mount` (the host allowlist, authored in Standard Wargear prose),
  // so that key is carried across even when the column wins everything else.
  function _forceOrg(ud) {
    if (!ud) return null;
    var prose = unitOptions(ud).forceOrg || null, col = ud.forceOrg || null;
    if (!col) return prose;
    var out = {};
    for (var k in col) if (col.hasOwnProperty(k)) out[k] = col[k];
    if (prose && prose.mount) out.mount = prose.mount;
    return out;
  }

  // A resolved reference from the column: an OR list of alternatives, each an AND list
  // of terms. Authored "A|B+C" — matches A, or anything that is both B and C.
  function _refMatches(ud, alts) {
    if (!ud || !alts || !alts.length) return false;
    var kws = _orgKeywords(ud).map(function (k) { return k.toLowerCase(); });
    var nm = (ud.name || '').toLowerCase();
    return alts.some(function (terms) {
      return terms.every(function (t) {
        var v = String(t.value || '').toLowerCase();
        if (t.kind === 'unit') return nm === v;
        if (t.kind === 'epicHero') return !!ud.epicHero || kws.indexOf('epic hero') !== -1;
        return kws.indexOf(v) !== -1;
      });
    });
  }

  // '<a>|<b>' reads as an OR in the column; spell it out in player-facing messages.
  function _refLabel(s) { return String(s).replace(/\s*\|\s*/g, ' or ').replace(/\s*\+\s*/g, ' + '); }

  // In-army units matching a reference. `excludeName` drops the unit that owns the
  // rule: the source prose always reads "1 OTHER …", and a referencing unit routinely
  // carries the keyword itself (a Squadron Commander is Squadron, a Commissar is
  // Regiment), which would otherwise let it satisfy its own requirement.
  function _countMatching(alts, excludeName, skip) {
    var n = 0;
    _state.selectedUnits.forEach(function (su) {
      if (su.unitName === excludeName) return;
      if (skip && skip.indexOf(su) !== -1) return;
      var sud = getUnitData(su.unitName);
      if (sud && _refMatches(sud, alts)) n++;
    });
    return n;
  }

  // The per-unit cap, or null to fall through to the keyword defaults. Every atom the
  // rule declares contributes a candidate and the tightest one wins, so "max 2" and
  // "max 1 per 2,000pts" on the same unit behave the way an author would read them.
  function _profileLimit(ud, pts) {
    var fo = _forceOrg(ud);
    if (!fo) return null;
    var best = null;
    function take(n, label) { if (best === null || n < best.limit) best = { limit: n, why: label }; }

    if (fo.max != null) take(fo.max, 'max ' + fo.max + ' per army');
    if (fo.tiers) {
      var lim = null;
      fo.tiers.forEach(function (t) {
        var okMax = (t.maxPoints == null) || pts <= t.maxPoints;
        var okMin = (t.minPoints == null) || pts >= t.minPoints;
        if (okMax && okMin) lim = t.count;
      });
      if (lim != null) take(lim, 'unit Force Organization limit');
    }
    if (fo.perPoints) {
      take(_perPoints(fo.perPoints.count, fo.perPoints.per, pts),
           'max ' + fo.perPoints.count + ' per ' + _fmtPts(fo.perPoints.per) + ' pts');
    }
    if (fo.perEach) {
      take(_countMatching(fo.perEach.refs, ud.name) * fo.perEach.count,
           'max ' + fo.perEach.count + ' per ' + _refLabel(fo.perEach.label));
    }
    if (fo.onePerEach) {
      // Legacy prose-derived form. Its references are unresolved strings, so a near
      // miss ("Regiment unit" against the keyword "Regiment") counts nothing and
      // yields 0 — which would block a legal list. Treat a zero here as "no rule
      // parsed" and fall through; the column path keeps a real 0 meaningful.
      var allow = 0;
      _state.selectedUnits.forEach(function (su) {
        var sud = getUnitData(su.unitName); if (!sud) return;
        var nm = su.unitName.toLowerCase(), kws = _kw(sud);
        fo.onePerEach.forEach(function (ref) {
          var r = String(ref).toLowerCase();
          if (nm === r || kws.indexOf(r) !== -1) allow++;
        });
      });
      if (allow > 0) take(allow, 'unit Force Organization limit');
    }
    return best;
  }

  function validateForceOrg() {
    var pts = _state.targetPoints, units = _state.selectedUnits;
    var violations = [], warnings = [];
    var byName = {}, byCat = {}, leader = 0, warlord = 0;

    units.forEach(function (su) {
      var ud = getUnitData(su.unitName); if (!ud) return;
      byName[su.unitName] = (byName[su.unitName] || 0) + 1;
      byCat[ud.category || '—'] = (byCat[ud.category || '—'] || 0) + 1;
      if (_kw(ud).indexOf('leader') !== -1) leader++;
      if (su.isWarlord) warlord++;
    });

    // Squadron Commander hosts: an eligible unit the player designated to carry a
    // Commander. Only as many hosts as there are Commanders are "active" (extra
    // flagged units count normally); an active host is exempt from its own unit's
    // force-org count (Leman Russ / Titanic / etc.).
    var commanders = units.filter(function (su) {
      var cud = getUnitData(su.unitName); return cud && _isSquadronCommander(cud);
    });
    var eligHostNames = squadronHostNames();
    var activeHosts = units.filter(function (su) { return su.squadronHost && eligHostNames[su.unitName]; })
                           .slice(0, commanders.length);
    var hostExempt = {};   // unit name -> # instances exempt from their force-org limit
    activeHosts.forEach(function (su) { hostExempt[su.unitName] = (hostExempt[su.unitName] || 0) + 1; });

    Object.keys(byName).forEach(function (name) {
      var ud = getUnitData(name); if (!ud) return;
      var count = byName[name] - (hostExempt[name] || 0), kws = _orgKeywords(ud).map(function (x) { return x.toLowerCase(); }), limit, why;   // resolved: traits add/remove Battleline etc. (R4)
      if (count <= 0) return;   // every instance of this unit is an active Commander host
      var prof = _profileLimit(ud, pts), ufo = _forceOrg(ud);
      if (ud.epicHero || kws.indexOf('epic hero') !== -1) { limit = 1; why = 'Epic Hero — max 1 per army'; }
      else if (prof != null) { limit = prof.limit; why = prof.why; }
      // "ignores character" units drop out of the Character cap and fall through to
      // the generic default, which is what the source prose means by "ignores the
      // force organization limitations associated with the Character keyword".
      // Titanic's per-unit cap belongs in the cascade with the other keywords — the
      // rules read "1x OF THE UNIT for every 1,000 points", not one Titanic unit in
      // total. Its battle-size minimum is the separate army-wide check further down.
      else if (kws.indexOf('titanic') !== -1) { limit = _perPoints(1, 1000, pts); why = 'Titanic — max 1 per 1,000 pts'; }
      else if (kws.indexOf('character') !== -1 && !(ufo && ufo.ignoresCharacter)) { limit = _perPoints(1, 1000, pts); why = 'Character — max 1 per 1,000 pts'; }
      else if (kws.indexOf('battleline') !== -1) { limit = _perPoints(2, 500, pts); why = 'Battleline — max 2 per 500 pts'; }
      else { limit = _perPoints(1, 500, pts); why = 'max 1 per 500 pts'; }
      if (count > limit) violations.push(name + ': ' + count + '/' + limit + ' (' + why + ')');
    });

    // Mount prerequisites (generic across any unit with forceOrg.mount — Squadron
    // Commander, Dread Baron, …; scale per commander): each needs its own designated
    // host. Some mounting units ALSO require the army to include N other units of a
    // given keyword (Squadron Commander → "Squadron"); others (Dread Baron) declare no
    // such prerequisite, so it is enforced per requiresOther keyword and ONLY for the
    // commanders that actually declare one.
    if (commanders.length) {
      if (activeHosts.length < commanders.length) {
        var cLabel = {};
        commanders.forEach(function (su) { cLabel[su.unitName] = true; });
        violations.push(Object.keys(cLabel).join(' / ') + ': designate a host unit for each (' +
          activeHosts.length + '/' + commanders.length + ')');
      }
      // Aggregate the "requires N other <keyword> unit" demand per keyword. A commander
      // with no requiresOther contributes nothing (no phantom "Squadron" sibling).
      // Read through _forceOrg so a commander whose faction has adopted the workbook
      // column is handled by the generic `requires` pass below instead, not twice.
      var needByKw = {};   // keyword(lower) -> { min, label }
      commanders.forEach(function (su) {
        var ro = (_forceOrg(getUnitData(su.unitName)) || {}).requiresOther;
        if (!ro || !ro.keyword) return;
        var k = ro.keyword.toLowerCase();
        needByKw[k] = needByKw[k] || { min: 0, label: ro.keyword };
        needByKw[k].min += (ro.min || 1);
      });
      Object.keys(needByKw).forEach(function (k) {
        var need = needByKw[k].min, label = needByKw[k].label, avail = 0;
        units.forEach(function (su) {
          if (activeHosts.indexOf(su) !== -1) return;          // an active host doesn't count
          var sud = getUnitData(su.unitName); if (!sud) return;
          if (_isSquadronCommander(sud)) return;               // nor another commander
          if (_kw(sud).indexOf(k) !== -1) avail++;
        });
        if (avail < need) {
          violations.push('Requires ' + need + ' other ' + label + ' unit' +
            (need === 1 ? '' : 's') + ' (' + avail + '/' + need + ' available)');
        }
      });
    }

    // Prerequisites from the Force Org Constraints column ("requires N <ref>"). This
    // runs for every unit that declares one, not only mounting units: the prose-derived
    // equivalent above sits inside the commanders branch, so a prerequisite on a unit
    // that mounts nothing (Kroot Shaper) was parsed and then never checked.
    Object.keys(byName).forEach(function (name) {
      var rud = getUnitData(name); if (!rud) return;
      var rfo = _forceOrg(rud); if (!rfo) return;
      var reqs = (rfo.requires || []).slice();
      // A prose-derived "at least N other <keyword> unit" belongs here too when the
      // unit mounts nothing — mounting units are handled above, where the demand is
      // aggregated per commander alongside host designation.
      if (!rfo.mount && rfo.requiresOther && rfo.requiresOther.keyword) {
        reqs.push({ count: rfo.requiresOther.min || 1, label: rfo.requiresOther.keyword,
                    refs: [[{ kind: 'keyword', value: rfo.requiresOther.keyword }]] });
      }
      reqs.forEach(function (rq) {
        var avail = _countMatching(rq.refs, name, activeHosts);   // a mounted host is spoken for
        if (avail < rq.count) {
          violations.push(name + ': requires ' + rq.count + ' other ' + _refLabel(rq.label) +
            ' unit' + (rq.count === 1 ? '' : 's') + ' (' + avail + '/' + rq.count + ' available)');
        }
      });
    });

    // "warlord" / "warlord unless <ref>". Only fires once a Warlord has been designated
    // somewhere else — with none designated at all the standing warning below already
    // says so, and flagging both would just be the same complaint twice.
    if (warlord > 0) {
      Object.keys(byName).forEach(function (name) {
        var wud = getUnitData(name); if (!wud) return;
        var wfo = _forceOrg(wud); if (!wfo || !wfo.warlord) return;
        if (units.some(function (su) { return su.unitName === name && su.isWarlord; })) return;
        if (wfo.warlord.unless && _countMatching(wfo.warlord.unless, name) > 0) return;
        violations.push(name + ' must be your Warlord' +
          (wfo.warlord.unlessLabel ? ' (unless your army includes ' + _refLabel(wfo.warlord.unlessLabel) + ')' : ''));
      });
    }

    // Titanic — the one keyword that gates on battle size. How MANY you may take is
    // per unit type and handled in the cascade above; this is only the floor on when
    // any of them may be taken at all.
    var titanic = 0;
    units.forEach(function (su) { var ud = getUnitData(su.unitName); if (ud && _kw(ud).indexOf('titanic') !== -1) titanic++; });
    activeHosts.forEach(function (su) { var hud = getUnitData(su.unitName); if (hud && _kw(hud).indexOf('titanic') !== -1) titanic--; });   // a hosted Baneblade isn't a Titanic unit of its own
    if (titanic > 0 && pts < 1500) violations.push('Titanic units require 1,500+ pts');

    // Dedicated Transports: "1 such unit for every Infantry unit in your army that is
    // eligible to be embarked in a Transport". Eligibility is the Transport [X] keyword's:
    // Infantry models of Toughness 4 or less, and never a model with Fly, Jump Pack,
    // Hover, Mounted, Vehicle, Walker or Beast. Character is NOT disqualifying. The
    // Toughness test is per model, so a unit qualifies when at least one of its models
    // could ride — Ork Boyz travel by Trukk even though their T5 Nob cannot.
    // The category is spelled plural in the unit data; the singular is tolerated so a
    // future sheet using it can't silently switch this rule off (as it did until now).
    var dt = (byCat['Dedicated Transports'] || 0) + (byCat['Dedicated Transport'] || 0);
    if (dt > 0) {
      var carriers = 0;
      units.forEach(function (su) {
        var ud = getUnitData(su.unitName); if (!ud) return;
        var kws = _kw(ud);
        if (kws.indexOf('infantry') === -1) return;
        if (NO_EMBARK.some(function (k) { return kws.indexOf(k) !== -1; })) return;
        if (_minToughness(ud) > 4) return;
        carriers++;
      });
      if (dt > carriers) violations.push('Dedicated Transports: ' + dt + '/' + carriers + ' (1 per eligible Infantry unit)');
    }

    // Warlord
    if (units.length > 0) {
      if (leader === 0) warnings.push('No Leader unit in the army');
      else if (warlord === 0) warnings.push('No Warlord designated — pick a Leader unit');
      if (warlord > 1) violations.push('Only 1 Warlord allowed (have ' + warlord + ')');
    }

    var totalPts = calcTotalPoints();
    if (totalPts > pts) violations.push('Over points limit: ' + totalPts + '/' + pts + ' pts');

    // Detachment-trait selection rules (R3) are army-wide — surface here.
    validateDetachment().violations.forEach(function (x) { violations.push(x); });

    return { violations: violations, warnings: warnings };
  }

  // ── Unit-level validation (incomplete compulsory choices) ────────────────────
  function unitIssues(entry) {
    var u = getUnitData(entry.unitName); if (!u) return [];
    var N = totalModels(entry), issues = [];
    // compulsory key characteristic: "must select N of the following …"
    keyCharInline(u).forEach(function (sec) {
      var need = _selectMin(sec), have = keyCharSelection(entry, sec.id).length;
      if (have < need) issues.push('Select ' + (need > 1 ? need + ' ' : '') + (sec.label || 'an option') +
        (need > 1 ? ' (' + have + '/' + need + ')' : ''));
    });
    // …and the compulsory picks the chosen profile itself carries (the Kroot Shaper's
    // Paths each open two "must be equipped with 1 of the following" lists). Scoped to
    // key-characteristic clauses: an unslotted compulsory choose elsewhere in the roster
    // has never been flagged, and starting now would be a behaviour change.
    clauses(u, entry).forEach(function (cl) {
      if (!cl.__keyChar || cl.op !== 'choose') return;
      var need = ((cl.pick || {}).min || 0) * Math.max(1, _scopedModelCount(entry, u, cl));
      if (need && clauseTotal(entry, cl.id) < need) {
        var sec = keyCharSection(u, cl.__keyChar);
        issues.push('Complete the ' + ((sec && sec.label) || 'selection') + ' wargear choices');
      }
    });
    // compulsory slot fills: each compulsory slot pool must be fully assigned
    var slots = {};
    clauses(u, entry).forEach(function (cl) {
      if (cl.op === 'choose' && cl.pick && cl.pick.min >= 1 && slotOf(cl)) {
        slots[slotOf(cl)] = true;
      }
    });
    Object.keys(slots).forEach(function (slot) {
      var used = slotUsed(entry, u, slot);
      if (used < N) issues.push('Assign ' + slot.replace(/-/g, ' ') + ' for all models (' + used + '/' + N + ')');
    });
    // compulsory sub-selections: each equipped instance must fill every min≥1 group
    clauses(u, entry).forEach(function (cl) {
      (cl.options || []).forEach(function (o) {
        var subs = itemSubSelections(o.ref); if (!subs) return;
        var need = subs.filter(function (g) { return g.pick && g.pick.min >= 1; });
        if (!need.length) return;
        var eq = equippedInstances(entry, u, cl, o.ref); if (!eq) return;
        var inst = itemInstances(o.ref), k = inst ? 1 : eq;
        var byModel = (entry.nested && entry.nested[nestedKey(cl.id, o.ref)]) || {};
        for (var i = 0; i < k; i++) {
          var picks = byModel[inst ? '0' : i] || {};
          need.forEach(function (g) {
            if (!(picks[g.id] || []).length)
              issues.push('Choose ' + (g.label || 'an option') + ' for ' + o.name + (k > 1 ? ' (model ' + (i + 1) + ')' : ''));
          });
        }
      });
    });
    return issues;
  }

  // ── State mutations ──────────────────────────────────────────────────────────
  function _entry(id) {
    return _state.selectedUnits.filter(function (u) { return u.id === id; })[0] || null;
  }

  function _parseSizes(str) {
    if (!str || str === '-') return { min: 1, max: 1 };
    var m = String(str).match(/(\d+)\s*(?:to|-)\s*(\d+)/);
    if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    var n = parseInt(str, 10);
    return isNaN(n) ? { min: 1, max: 1 } : { min: n, max: n };
  }
  function _mtSquadStr(u, name) {
    var m = ((unitOptions(u).composition || {}).modelTypes || []).filter(function (x) { return x.name === name; })[0];
    return m && m.stats && m.stats.squadSizes;
  }
  // Coupled composition transform (Heavy Weapons Team): the model type carrying a
  // `transform` {model, takes} is the *product* (HWT); `model` is the *source*
  // (Guardsman) it consumes `takes` of per product. Total bodies are conserved:
  // S = source + takes*product. Returns {product, source, takes} or null.
  function _unitTransform(u) {
    var mts = (unitOptions(u).composition || {}).modelTypes || [];
    for (var i = 0; i < mts.length; i++)
      if (mts[i].transform) return { product: mts[i].name, source: mts[i].transform.model, takes: mts[i].transform.takes || 1 };
    return null;
  }
  function isTransform(u) { return !!_unitTransform(u); }

  // Per-model-type count bounds (range/single use composition; multi reads each type's squadSizes).
  // A model type may carry a `countLimit` {n,per,model} (ratio cap) → max floor(count(driver)/per)*n,
  // or the unit may have a `transform` (source ⇄ product coupling). Both are DYNAMIC (need the
  // entry's current counts); entry omitted (addUnit init) → static squadSizes only.
  function modelTypeBounds(u, modelType, entry) {
    var comp = unitOptions(u).composition || {};
    if (comp.mode === 'single') return { min: 1, max: 1 };
    if (comp.mode === 'range' && comp.range) return { min: comp.range.min, max: comp.range.max };
    if (comp.mode === 'multi') {
      var mt = (comp.modelTypes || []).filter(function (m) { return m.name === modelType; })[0];
      var b = _parseSizes(mt && mt.stats && mt.stats.squadSizes);
      if (mt && mt.countLimit && entry) {
        var cl = mt.countLimit;
        var driver = (entry.modelCounts && entry.modelCounts[cl.model]) || 0;
        var ratioMax = Math.floor(driver / (cl.per || 1)) * (cl.n || 0);
        b = { min: b.min, max: Math.min(b.max, ratioMax) };
      }
      var tr = _unitTransform(u);
      if (tr && entry) {
        var P = entry.modelCounts[tr.product] || 0, M = entry.modelCounts[tr.source] || 0;
        var S = M + tr.takes * P;   // conserved total bodies
        // source (Guardsman): squad-size range b, minus the crew committed to products
        if (modelType === tr.source) return { min: Math.max(0, b.min - tr.takes * P), max: Math.max(0, b.max - tr.takes * P) };
        // product (HWT): flat cap b.max, further bounded by available crew (S / takes)
        if (modelType === tr.product) return { min: 0, max: Math.max(0, Math.min(b.max, Math.floor(S / tr.takes))) };
      }
      return b;
    }
    return { min: 0, max: 99 };
  }
  // Adjust a transform unit's counts, conserving total bodies. Changing the product
  // (HWT) trades crew with the source (+1 product ⇒ −takes source); changing the
  // source grows/shrinks the squad (its bounds already exclude committed crew).
  function _setTransformCount(e, u, tr, modelType, n) {
    var P = e.modelCounts[tr.product] || 0, M = e.modelCounts[tr.source] || 0;
    var S = M + tr.takes * P;
    if (modelType === tr.product) {
      var pMax = Math.min(_parseSizes(_mtSquadStr(u, tr.product)).max, Math.floor(S / tr.takes));
      var newP = Math.max(0, Math.min(pMax, n));
      e.modelCounts[tr.product] = newP;
      e.modelCounts[tr.source] = S - tr.takes * newP;
    } else if (modelType === tr.source) {
      var b = modelTypeBounds(u, modelType, e);
      e.modelCounts[tr.source] = Math.max(b.min, Math.min(b.max, n));
    } else {
      var b2 = modelTypeBounds(u, modelType, e);
      e.modelCounts[modelType] = Math.max(b2.min, Math.min(b2.max, n));
    }
  }
  // Pull ratio-limited model counts down when their driver's count drops. Only lowers
  // (never forces up), and skips variant/transform units (they own their coupling).
  function _clampModelCounts(e, u) {
    if (isVariant(u) || isTransform(u)) return;
    modelTypes(u).forEach(function (mt) {
      var max = modelTypeBounds(u, mt.name, e).max;
      if ((e.modelCounts[mt.name] || 0) > max) e.modelCounts[mt.name] = max;
    });
  }

  function addUnit(name) {
    var u = getUnitData(name); if (!u) return;
    var comp = unitOptions(u).composition || {};
    var modelCounts = {};
    var mts = modelTypes(u);
    if (comp.mode === 'range' && comp.range) {
      modelCounts[mts[0].name] = comp.range.min || 1;
    } else if (comp.mode === 'tiers' && comp.tiers && comp.tiers.length) {
      var t0 = comp.tiers[0];
      Object.keys(t0.models || {}).forEach(function (k) { modelCounts[k] = t0.models[k]; });
    } else if (comp.mode === 'multi') {
      if (isVariant(u)) {
        // variant (R5): first line at its min, the other at 0 (mutual exclusion)
        mts.forEach(function (mt, i) { modelCounts[mt.name] = i === 0 ? modelTypeBounds(u, mt.name).min : 0; });
      } else {
        // additive multi: each model type starts at its own minimum (e.g. mandatory Drones)
        mts.forEach(function (mt) { modelCounts[mt.name] = modelTypeBounds(u, mt.name).min; });
      }
    } else {
      mts.forEach(function (mt) { modelCounts[mt.name] = (mt.name === u.name ? 1 : 0); });
      if (Object.keys(modelCounts).length === 0) modelCounts[u.name] = 1;
    }
    var entry = { id: 'u' + (_nextId++), unitName: name, modelCounts: modelCounts,
                  tier: (comp.mode === 'tiers' ? 0 : null), sel: {}, keyChar: {},
                  isWarlord: false, squadronHost: false, computedPoints: 0 };
    _clampModelCounts(entry, u);   // resolve any static-min above a dynamic ratio max at init
    _clampKeyChar(entry, u);       // pre-select a compulsory key characteristic (never invalid on drop)
    calcUnitPoints(entry);
    _state.selectedUnits.push(entry);
    _state.selectedUnitId = entry.id;
    saveState();
  }

  function removeUnit(id) {
    _state.selectedUnits = _state.selectedUnits.filter(function (u) { return u.id !== id; });
    if (_state.selectedUnitId === id) _state.selectedUnitId = null;
    _reconcileHosts();   // commander removed → clear now-orphaned host flags
    saveState();
  }
  // Deep-clone a unit instance (with its full loadout) and insert it after the source.
  function duplicateUnit(id) {
    var src = _entry(id); if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = 'u' + (_nextId++);
    copy.isWarlord = false;                 // a duplicate is never auto-Warlord (max 1 per army)
    copy.squadronHost = false;              // nor auto-host (each host carries one commander)
    var idx = _state.selectedUnits.indexOf(src);
    _state.selectedUnits.splice(idx + 1, 0, copy);
    _state.selectedUnitId = copy.id;
    calcUnitPoints(copy);
    saveState();
  }
  function selectUnit(id) { _state.selectedUnitId = id; saveState(); }

  // ── Variant composition (R5): Sternguard ⊻ Vanguard ─────────────────────────
  // A variant unit has two mutually-exclusive model lines: it is 3–5 of one OR
  // 3–5 of the other, never a mix. Detected at runtime (no data change): a multi
  // unit with exactly two model types whose prose offers them as alternatives.
  function isVariant(u) {
    var c = unitOptions(u).composition || {};
    return c.mode === 'multi' && (c.modelTypes || []).length === 2 && /\bor\b/i.test(c.prose || '');
  }
  // A variant line's valid counts are {0} ∪ [min,max]: incrementing from 0 snaps to
  // min, decrementing below min releases to 0; activating a line zeroes the other.
  function _setVariantCount(e, u, modelType, n) {
    var b = modelTypeBounds(u, modelType), cur = e.modelCounts[modelType] || 0, nv;
    if (n <= 0) nv = 0;
    else if (n < b.min) nv = (n > cur ? b.min : 0);
    else nv = Math.min(b.max, n);
    e.modelCounts[modelType] = nv;
    if (nv > 0) modelTypes(u).forEach(function (mt) { if (mt.name !== modelType) e.modelCounts[mt.name] = 0; });
  }

  function setModelTypeCount(id, modelType, n) {
    var e = _entry(id); if (!e) return;
    var u = getUnitData(e.unitName);
    var tr = _unitTransform(u);
    if (isVariant(u)) {
      _setVariantCount(e, u, modelType, n);
    } else if (tr) {
      _setTransformCount(e, u, tr, modelType, n);   // +1 HWT = -takes source (bodies conserved)
    } else {
      var b = modelTypeBounds(u, modelType, e);
      e.modelCounts[modelType] = Math.max(b.min, Math.min(b.max, n));
      _clampModelCounts(e, u);   // driver changed → re-clamp ratio-limited types (Squad Size Constraints)
    }
    _reclamp(e, u, 'composition');
    calcUnitPoints(e); saveState();
  }
  function setTier(id, tierIdx) {
    var e = _entry(id); if (!e) return;
    var u = getUnitData(e.unitName); var comp = unitOptions(u).composition || {};
    var t = (comp.tiers || [])[tierIdx]; if (!t) return;
    e.tier = tierIdx; e.modelCounts = {};
    Object.keys(t.models || {}).forEach(function (k) { e.modelCounts[k] = t.models[k]; });
    _reclamp(e, u, 'composition');
    calcUnitPoints(e); saveState();
  }

  // The clamp cascade run after any change to a unit. Order matters — each clamp can
  // invalidate what a later one inspects. The mode selects the two situational passes:
  //   'composition' — the model count moved, so selections may now exceed their caps
  //   'selection'   — an option was taken, so unit-wide wargear group caps must re-check
  //   'all'         — both, for a list arriving from outside (see hydrate)
  function _reclamp(e, u, mode) {
    var all = mode === 'all';
    if (all || mode === 'composition') _clampSelections(e, u);
    _clampConditionals(e, u);
    _clampAvailability(e, u);
    if (all || mode === 'selection') _clampUnitCap(e, u);
    _clampRelic(e, u);
    _clampSuppressed(e, u);
    _clampNested(e, u);
    _clampSubRelic(e, u);
    _clampGifts(e, u);
    _clampKeyChar(e, u);
  }

  // After composition shrinks, clamp all selections to new caps.
  function _clampSelections(e, u) {
    clauses(u, e).forEach(function (cl) {
      var sel = e.sel[cl.id]; if (!sel) return;
      Object.keys(sel).forEach(function (ref) {
        if (ref === '__count') {
          sel.__count = Math.min(sel.__count, optionCap(e, u, cl, ref));
          if (!sel.__count) delete sel.__count;
          return;
        }
        var cap = optionCap(e, u, cl, ref);
        if (sel[ref] > cap) sel[ref] = cap;
        if (sel[ref] <= 0) delete sel[ref];
      });
    });
  }

  // Clear selections for clauses whose conditional (requires) is no longer satisfied
  // — e.g. removing Phobos Armour drops the Riever Gear / Camo Cloak picks.
  function _clampConditionals(e, u) {
    clauses(u, e).forEach(function (cl) {
      if (!(cl.scope && cl.scope.requires)) return;
      if (requiresCap(e, u, cl) > 0) return;
      if (e.sel[cl.id]) delete e.sel[cl.id];
      if (e.nested) Object.keys(e.nested).forEach(function (k) {
        if (k.indexOf(cl.id + '::') === 0) delete e.nested[k];
      });
    });
  }

  function adjustOption(id, clauseId, ref, delta) {
    var e = _entry(id); if (!e) return;
    var u = getUnitData(e.unitName); var cl = findClause(u, clauseId); if (!cl) return;
    if (delta > 0 && requiresCap(e, u, cl) <= 0) return;   // gated → block new selection
    if (delta > 0 && !optAvailable(e, u, findOpt(cl, ref))) return;  // armour/mount excludes this weapon
    if (unitCapBlocked(e, u, cl, ref, delta)) return;      // wargear group cap reached (e.g. one mount per unit)
    if (!e.sel[clauseId]) e.sel[clauseId] = {};
    var sel = e.sel[clauseId];
    var cur = sel[ref] || 0;
    var cap = optionCap(e, u, cl, ref);
    var nv = Math.max(0, Math.min(cap, cur + delta));
    if (nv === 0) delete sel[ref]; else sel[ref] = nv;
    if (Object.keys(sel).length === 0) delete e.sel[clauseId];
    _reclamp(e, u, 'selection');
    calcUnitPoints(e); saveState();
  }

  // Radio: exactly one option (used for who:unit, and who:each pick-one when N===1)
  function setRadioOption(id, clauseId, ref) {
    var e = _entry(id); if (!e) return;
    var u = getUnitData(e.unitName); var cl = findClause(u, clauseId); if (!cl) return;
    var sel = e.sel[clauseId] || {};
    var turningOn = !sel[ref];
    if (turningOn && requiresCap(e, u, cl) <= 0) return;   // gated → block new selection
    if (turningOn && !optAvailable(e, u, findOpt(cl, ref))) return;  // armour/mount excludes this weapon
    if (turningOn && unitCapBlocked(e, u, cl, ref, 1)) return;  // wargear group cap reached
    if (sel[ref]) { delete e.sel[clauseId]; }          // toggle off
    else {
      // clearing the rest of this clause's pool is automatic (replace single key)
      e.sel[clauseId] = {}; e.sel[clauseId][ref] = 1;
    }
    _reclamp(e, u, 'selection');
    calcUnitPoints(e); saveState();
  }

  // Pick/unpick a sub-option within one group of one equipped model instance.
  // max===1 → radio (toggle); otherwise checkbox honouring pick.max.
  function setNestedPick(id, clauseId, optRef, modelIdx, groupId, subRef) {
    var e = _entry(id); if (!e) return;
    var subs = itemSubSelections(optRef); if (!subs) return;
    var grp = _subGroup(subs, groupId); if (!grp) return;
    if (!e.nested) e.nested = {};
    var key = nestedKey(clauseId, optRef);
    var byModel = e.nested[key] || (e.nested[key] = {});
    var byGroup = byModel[modelIdx] || (byModel[modelIdx] = {});
    var cur = byGroup[groupId] || [], max = grp.pick && grp.pick.max, i = cur.indexOf(subRef);
    if (max === 1) {
      byGroup[groupId] = (cur[0] === subRef) ? [] : [subRef];         // radio toggle
    } else if (i !== -1) {
      var c2 = cur.slice(); c2.splice(i, 1); byGroup[groupId] = c2;    // uncheck
    } else if (max == null || cur.length < max) {
      byGroup[groupId] = cur.concat([subRef]);                        // check (≤ max)
    }
    if (!(byGroup[groupId] || []).length) delete byGroup[groupId];
    if (!Object.keys(byGroup).length) delete byModel[modelIdx];
    if (!Object.keys(byModel).length) delete e.nested[key];
    _clampSubRelic(e);   // a changed pick drops the previous weapon's relic mark
    calcUnitPoints(e); saveState();
  }
  // Set the chosen instance count (e.g. 2 or 4 Sponsons) for an instances-item.
  function setInstanceCount(id, clauseId, optRef, count) {
    var e = _entry(id); if (!e) return;
    var inst = itemInstances(optRef); if (!inst || inst.counts.indexOf(count) === -1) return;
    if (!e.instanceCount) e.instanceCount = {};
    e.instanceCount[nestedKey(clauseId, optRef)] = count;
    calcUnitPoints(e); saveState();
  }
  // Drop sub-selection state for model instances that no longer exist (count shrank
  // or the option was deselected), and stale instance counts.
  function _clampNested(e, u) {
    if (e.nested) clauses(u, e).forEach(function (cl) {
      (cl.options || []).forEach(function (o) {
        if (!itemSubSelections(o.ref)) return;
        var key = nestedKey(cl.id, o.ref), byModel = e.nested[key]; if (!byModel) return;
        var inst = itemInstances(o.ref), k = inst ? 1 : equippedInstances(e, u, cl, o.ref);
        Object.keys(byModel).forEach(function (idxStr) {
          var keep = inst ? (idxStr === '0') : (parseInt(idxStr, 10) < k);
          if (!keep) delete byModel[idxStr];
        });
        if (!Object.keys(byModel).length) delete e.nested[key];
      });
    });
    if (e.instanceCount) clauses(u, e).forEach(function (cl) {
      (cl.options || []).forEach(function (o) {
        if (itemInstances(o.ref) && equippedInstances(e, u, cl, o.ref) === 0)
          delete e.instanceCount[nestedKey(cl.id, o.ref)];
      });
    });
  }

  function adjustModifierCount(id, clauseId, delta) {
    var e = _entry(id); if (!e) return;
    var u = getUnitData(e.unitName); var cl = findClause(u, clauseId); if (!cl) return;
    if (!e.sel[clauseId]) e.sel[clauseId] = {};
    var sel = e.sel[clauseId];
    var cur = sel.__count || 0;
    var nv = Math.max(0, cur + delta);
    if (nv === 0) { delete sel.__count; if (!Object.keys(sel).length) delete e.sel[clauseId]; }
    else sel.__count = nv;
    calcUnitPoints(e); saveState();
  }

  function setWarlord(id, on) {
    if (on) _state.selectedUnits.forEach(function (u) { u.isWarlord = false; });
    var e = _entry(id); if (e) e.isWarlord = on;
    saveState();
  }

  // ── Squadron Commander mounting (host designator) ────────────────────────────
  // A "host" is an eligible Squadron unit the player designates to carry a Squadron
  // Commander. The host becomes part of the Commander and does NOT count toward its
  // own unit's force-org limit (rules: "does not count towards the maximum number of
  // units…"). Host eligibility is the union of the mount allowlists of the Squadron
  // Commander unit(s) currently in the army, minus Titanic hosts below 1,500 pts.
  function _isSquadronCommander(ud) {
    var fo = _forceOrg(ud);
    return !!(fo && fo.mount);
  }
  // Names of the in-army mounting units that may mount in a given host — used to label
  // the host designator ("Host a Dread Baron") without hard-coding any unit.
  function mountUnitsForHost(hostName) {
    var out = {};
    _state.selectedUnits.forEach(function (su) {
      var ud = getUnitData(su.unitName); if (!ud) return;
      var fo = _forceOrg(ud); if (!fo || !fo.mount) return;
      if ((fo.mount.hosts || []).indexOf(hostName) !== -1) out[su.unitName] = true;
    });
    return Object.keys(out);
  }
  function squadronHostNames() {
    var names = {};
    _state.selectedUnits.forEach(function (su) {
      var ud = getUnitData(su.unitName); if (!ud) return;
      var fo = _forceOrg(ud); if (!fo || !fo.mount) return;
      (fo.mount.hosts || []).forEach(function (h) { names[h] = true; });
    });
    // Titanic hosts (e.g. Baneblade) are legal only in games of 1,500+ pts.
    Object.keys(names).forEach(function (nm) {
      var hud = getUnitData(nm);
      if (hud && _kw(hud).indexOf('titanic') !== -1 && _state.targetPoints < 1500) delete names[nm];
    });
    return names;
  }
  function isHostEligible(unitName) { return !!squadronHostNames()[unitName]; }
  function setSquadronHost(id, on) {
    var e = _entry(id); if (e) e.squadronHost = !!on;
    saveState();
  }
  // Clear host flags that are no longer eligible (commander removed, points lowered
  // below a Titanic host's threshold). Called after army-level changes.
  function _reconcileHosts() {
    var names = squadronHostNames();
    _state.selectedUnits.forEach(function (su) {
      if (su.squadronHost && !names[su.unitName]) su.squadronHost = false;
    });
  }

  function setFaction(slug) {
    _state.faction = slug; _state.selectedUnits = []; _state.selectedUnitId = null;
    _state.detachmentTraitsSelected = []; _state.detachmentTraitChoices = {};
    _data.units = _data.factionWargear = _data.detachmentTraits = null;
    saveState();
  }
  function setTargetPoints(p) { _state.targetPoints = p; _reconcileHosts(); saveState(); }
  function setListName(name) { _state.listName = String(name == null ? '' : name).slice(0, 120); saveState(); }

  // ── Detachment-trait selection rules: budget / cap / exclusivity (R3) ────────
  // Data (scripts/convert_upgrades.py): file-level detachmentPoints = budget;
  // each trait carries detachmentPointsCost + selection.{subcategoryCap,
  // exclusivityGroup}, with category as the cap-grouping key. Each trait ID is a
  // single entry (multi-row traits were de-duplicated at ingest), so counting the
  // selected IDs counts each trait once.
  function _traitById(id) {
    var list = (_data.detachmentTraits && _data.detachmentTraits.detachmentTraits) || [];
    for (var i = 0; i < list.length; i++) if (list[i].traitId === id) return list[i];
    return null;
  }
  function _traitCost(t) { return (t && t.detachmentPointsCost) || 0; }
  function detachmentBudget() {
    var dd = _data.detachmentTraits;
    return dd && dd.detachmentPoints != null ? dd.detachmentPoints : null;
  }
  function detachmentSpent() {
    return _state.detachmentTraitsSelected.reduce(function (s, id) { return s + _traitCost(_traitById(id)); }, 0);
  }
  // Would selecting `id` keep the detachment valid? (Already-selected → true.)
  function canSelectTrait(id) {
    if (_state.detachmentTraitsSelected.indexOf(id) !== -1) return true;
    var t = _traitById(id); if (!t) return false;
    var budget = detachmentBudget();
    if (budget != null && detachmentSpent() + _traitCost(t) > budget) return false;
    var sel = t.selection || {};
    if (sel.subcategoryCap != null) {
      var cat = t.category || '';
      var inCat = _state.detachmentTraitsSelected.filter(function (sid) {
        var st = _traitById(sid); return st && (st.category || '') === cat;
      }).length;
      if (inCat >= sel.subcategoryCap) return false;
    }
    if (sel.exclusivityGroup != null) {
      var clash = _state.detachmentTraitsSelected.some(function (sid) {
        var st = _traitById(sid); return st && st.selection && st.selection.exclusivityGroup === sel.exclusivityGroup;
      });
      if (clash) return false;
    }
    return true;
  }
  function validateDetachment() {
    var budget = detachmentBudget(), spent = detachmentSpent(), violations = [];
    if (budget != null && spent > budget) violations.push('Detachment Points over budget: ' + spent + '/' + budget);
    var byCat = {}, byGrp = {};
    _state.detachmentTraitsSelected.forEach(function (id) {
      var t = _traitById(id); if (!t) return;
      var sel = t.selection || {};
      var cat = t.category || '';
      byCat[cat] = byCat[cat] || { count: 0, cap: sel.subcategoryCap != null ? sel.subcategoryCap : null };
      byCat[cat].count++;
      if (sel.exclusivityGroup != null) byGrp[sel.exclusivityGroup] = (byGrp[sel.exclusivityGroup] || 0) + 1;
    });
    Object.keys(byCat).forEach(function (cat) {
      var c = byCat[cat];
      if (c.cap != null && c.count > c.cap) violations.push((cat || 'Detachment Traits') + ': ' + c.count + '/' + c.cap + ' selected');
    });
    Object.keys(byGrp).forEach(function (grp) {
      if (byGrp[grp] > 1) violations.push('Mutually exclusive Detachment Traits selected (' + grp + ')');
    });
    // A trait whose sub-selection is unmade grants nothing — say so rather than let the
    // list read as finished (Aspect Host without its Battleline unit chosen).
    pendingTraitChoices().forEach(function (p) {
      violations.push(p.traitName + ': choose ' + (p.need > 1 ? p.need - p.have + ' more' : '1')
        + ' of the listed options');
    });
    return { spent: spent, budget: budget, violations: violations };
  }
  function selectDetachmentTrait(id, on) {
    var a = _state.detachmentTraitsSelected;
    if (on) { if (a.indexOf(id) === -1 && canSelectTrait(id)) a.push(id); }
    else {
      _state.detachmentTraitsSelected = a.filter(function (t) { return t !== id; });
      delete _state.detachmentTraitChoices[id];   // picks belong to the trait, not the list
    }
    saveState();
  }

  // ── Trait sub-selections ────────────────────────────────────────────────────
  // Traits may put a decision to the player (trait.choices): pick N of the listed
  // options, and only the rows carrying those options apply. See _rowChosen.
  function traitChoices(t) { return (t && t.choices) || []; }
  function traitChoice(traitId, choiceId) {
    return ((_state.detachmentTraitChoices || {})[traitId] || {})[choiceId] || [];
  }
  // Toggle one option. Radio-like when pick is 1 (the new option replaces the old);
  // additive up to `pick` when more than one is wanted.
  function setTraitChoice(traitId, choiceId, optionId, on) {
    var t = _traitById(traitId); if (!t) return;
    var c = traitChoices(t).filter(function (x) { return x.choiceId === choiceId; })[0];
    if (!c) return;
    if (!c.options.some(function (o) { return o.optionId === optionId; })) return;

    var byTrait = _state.detachmentTraitChoices[traitId] || (_state.detachmentTraitChoices[traitId] = {});
    var cur = byTrait[choiceId] || [];
    var need = c.pick || 1;
    if (!on) cur = cur.filter(function (x) { return x !== optionId; });
    else if (need === 1) cur = [optionId];
    else if (cur.indexOf(optionId) === -1 && cur.length < need) cur = cur.concat([optionId]);
    byTrait[choiceId] = cur;
    saveState();
  }
  // Choices still owed by the selected traits, for validation and for the UI's
  // "needs a pick" state. One entry per unsatisfied group.
  function pendingTraitChoices() {
    var out = [];
    _activeTraits().forEach(function (t) {
      traitChoices(t).forEach(function (c) {
        var need = c.pick || 1, have = traitChoice(t.traitId, c.choiceId).length;
        if (have < need) out.push({ traitId: t.traitId, traitName: t.name, choiceId: c.choiceId,
                                    need: need, have: have });
      });
    });
    return out;
  }
  // Drop picks that the current data can no longer support — a trait that lost its
  // choice group, an option that was renamed, or more picks than the group allows.
  function _reconcileTraitChoices() {
    var kept = {}, dropped = [];
    Object.keys(_state.detachmentTraitChoices || {}).forEach(function (traitId) {
      var t = _traitById(traitId);
      if (!t || _state.detachmentTraitsSelected.indexOf(traitId) === -1) {
        dropped.push(traitId); return;
      }
      var groups = {};
      Object.keys(_state.detachmentTraitChoices[traitId]).forEach(function (choiceId) {
        var c = traitChoices(t).filter(function (x) { return x.choiceId === choiceId; })[0];
        if (!c) { dropped.push(traitId); return; }
        var valid = (_state.detachmentTraitChoices[traitId][choiceId] || []).filter(function (opt) {
          return c.options.some(function (o) { return o.optionId === opt; });
        }).slice(0, c.pick || 1);
        if (valid.length) groups[choiceId] = valid;
        if (valid.length !== (_state.detachmentTraitChoices[traitId][choiceId] || []).length) dropped.push(traitId);
      });
      if (Object.keys(groups).length) kept[traitId] = groups;
    });
    _state.detachmentTraitChoices = kept;
    return dropped.filter(function (id, i) { return dropped.indexOf(id) === i; });
  }

  // ── Hydration from an external list (share link, saved library) ──────────────
  // Nothing is trusted: instance ids are reissued, every clamp runs, and anything the
  // faction's CURRENT data can no longer support is dropped and reported. The unit
  // JSON is regenerated from the source documents regularly, so a link made months
  // ago must open with a warning rather than fail or — far worse — misprice silently.
  //
  // Call only after loadFaction() has resolved for state.faction.
  function hydrate(state) {
    var notes = [];
    var s = Object.assign(_defaultState(), state || {});
    s.selectedUnits = [];
    _nextId = 1;

    ((state && state.selectedUnits) || []).forEach(function (raw) {
      var u = getUnitData(raw && raw.unitName);
      if (!u) { notes.push('“' + ((raw && raw.unitName) || 'Unknown unit') + '” is no longer in this faction’s data — dropped'); return; }
      var e = Object.assign({}, raw);
      e.id = 'u' + (_nextId++);
      e.modelCounts = e.modelCounts || {};
      e.sel = e.sel || {};
      e.keyChar = e.keyChar || {};
      e.isWarlord = !!e.isWarlord;
      e.squadronHost = !!e.squadronHost;
      var before = _selectionFingerprint(e);
      _clampModelCounts(e, u);
      _reclamp(e, u, 'all');
      if (_selectionFingerprint(e) !== before) {
        notes.push('“' + raw.unitName + '” — some selections no longer fit the current rules and were adjusted');
      }
      calcUnitPoints(e);
      s.selectedUnits.push(e);
    });

    s.detachmentTraitsSelected = (s.detachmentTraitsSelected || []).filter(function (id) {
      if (_traitById(id)) return true;
      notes.push('Detachment Trait “' + id + '” no longer exists — dropped');
      return false;
    });
    s.detachmentTraitChoices = s.detachmentTraitChoices || {};
    s.selectedUnitId = s.selectedUnits.length ? s.selectedUnits[0].id : null;

    _state = s;
    // Reconcile against the CURRENT data, not the data the link was made with: an
    // option renamed since then must not silently keep granting its keyword.
    _reconcileTraitChoices().forEach(function (traitId) {
      var t = _traitById(traitId);
      notes.push('“' + ((t && t.name) || traitId) + '” — its selection is no longer '
        + 'available in this faction’s data and needs choosing again');
    });
    saveState();
    return { notes: notes, units: s.selectedUnits.length };
  }
  function _selectionFingerprint(e) {
    return JSON.stringify([e.modelCounts, e.sel, e.keyChar, e.gifts || null, e.relic || null,
                           e.nested || null, e.instanceCount || null, e.subRelic || null, e.tier]);
  }
  // Re-run every clamp over the whole list (after a data reload).
  function clampAll() {
    _state.selectedUnits.forEach(function (e) {
      var u = getUnitData(e.unitName); if (!u) return;
      _clampModelCounts(e, u);
      _reclamp(e, u, 'all');
      calcUnitPoints(e);
    });
    saveState();
  }

  // The minimum state a share link must carry: everything the player chose, nothing
  // that can be recomputed (instance ids, cached points, which unit is on screen).
  function exportState() {
    return {
      listName: _state.listName || '',
      faction: _state.faction,
      targetPoints: _state.targetPoints,
      detachmentTraitsSelected: (_state.detachmentTraitsSelected || []).slice(),
      detachmentTraitChoices: JSON.parse(JSON.stringify(_state.detachmentTraitChoices || {})),
      selectedUnits: _state.selectedUnits.map(function (e) {
        var o = { unitName: e.unitName, modelCounts: e.modelCounts };
        if (e.tier != null) o.tier = e.tier;
        if (e.isWarlord) o.isWarlord = 1;
        if (e.squadronHost) o.squadronHost = 1;
        ['sel', 'keyChar', 'gifts', 'relic', 'nested', 'instanceCount', 'subRelic'].forEach(function (k) {
          if (e[k] && Object.keys(e[k]).length) o[k] = e[k];
        });
        return o;
      }),
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────
  function saveState() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(_state)); } catch (e) {} }
  function loadState() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY); if (!raw) return false;
      var s = JSON.parse(raw);
      (s.selectedUnits || []).forEach(function (u) {
        var n = parseInt(String(u.id).replace('u', ''), 10);
        if (n >= _nextId) _nextId = n + 1;
      });
      _state = Object.assign(_defaultState(), s);
      return true;
    } catch (e) { return false; }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.LB = {
    get state() { return _state; },
    get data() { return _data; },
    BATTLE_SIZES: BATTLE_SIZES,
    loadFactionList: loadFactionList, loadFaction: loadFaction,
    setFaction: setFaction, setTargetPoints: setTargetPoints,
    addUnit: addUnit, removeUnit: removeUnit, duplicateUnit: duplicateUnit, selectUnit: selectUnit,
    setModelTypeCount: setModelTypeCount, setTier: setTier,
    adjustOption: adjustOption, setRadioOption: setRadioOption, adjustModifierCount: adjustModifierCount,
    weaponCost: _weaponCost,
    // sub-selections (combi / turret / warsuit / sponson)
    itemSubSelections: itemSubSelections, itemInstances: itemInstances, itemSuppresses: itemSuppresses,
    itemIncludedWeapons: itemIncludedWeapons,
    equippedInstances: equippedInstances, instanceCountFor: instanceCountFor, nestedPicks: nestedPicks,
    setNestedPick: setNestedPick, setInstanceCount: setInstanceCount,
    suppressedModelCount: suppressedModelCount, isSuppressibleClause: isSuppressibleClause,
    itemRelicUpgrade: itemRelicUpgrade, subRelicEligible: subRelicEligible,
    subRelicMarked: subRelicMarked, setSubRelic: setSubRelic,
    replacedStandardWeapons: replacedStandardWeapons,
    relicModifier: relicModifier, relicEligible: relicEligible, optEquipped: optEquipped, setRelic: setRelic,
    modifierMarginalCost: _modifierMarginalCost,
    setWarlord: setWarlord, setSquadronHost: setSquadronHost, isHostEligible: isHostEligible,
    mountUnitsForHost: mountUnitsForHost,
    selectDetachmentTrait: selectDetachmentTrait,
    canSelectTrait: canSelectTrait, validateDetachment: validateDetachment,
    traitChoices: traitChoices, traitChoice: traitChoice, setTraitChoice: setTraitChoice,
    pendingTraitChoices: pendingTraitChoices,
    detachmentBudget: detachmentBudget, detachmentSpent: detachmentSpent,
    calcUnitPoints: calcUnitPoints, calcTotalPoints: calcTotalPoints,
    validateForceOrg: validateForceOrg, unitIssues: unitIssues,
    // read-only roster projection (export view, share links, clipboard)
    unitLoadout: unitLoadout, listSummary: listSummary, categoryOrder: categoryOrder,
    weaponProfiles: weaponProfiles, weaponAppendix: weaponAppendix,
    STAT_KEYS: STAT_KEYS, statLabel: statLabel,
    toMarkdown: toMarkdown, setListName: setListName,
    // helpers for the UI renderer
    getUnitData: getUnitData, unitOptions: unitOptions, modelTypes: modelTypes, modelTypeBounds: modelTypeBounds,
    clauses: clauses, totalModels: totalModels, slotOf: slotOf, isSlotPooled: isSlotPooled, isVariant: isVariant, isTransform: isTransform,
    optionCap: optionCap, clauseSubCap: clauseSubCap, clauseTotal: clauseTotal, slotUsed: slotUsed,
    requiresCap: requiresCap, equippedCount: equippedCount,
    governingToken: governingToken, weaponAvailable: weaponAvailable, weaponAvailabilityList: weaponAvailabilityList,
    unitCapRoom: unitCapRoom, unitCapBlocked: unitCapBlocked,
    // statline-banded wargear (points vary by the model's own statline)
    optDisplayPoints: optDisplayPoints, bandTakeable: bandTakeable,
    // selectable upgrade catalogs (Gifts of Chaos)
    unitCatalog: unitCatalog, unitAllowances: unitAllowances, allowanceKey: allowanceKey,
    catalogItem: catalogItem, giftTier: giftTier, giftTakeable: giftTakeable,
    giftSelection: giftSelection, toggleGift: toggleGift, giftsCost: giftsCost,
    // key unit characteristics (Path of Study, Harnessed God, Shaper's Path, …)
    keyCharSections: keyCharSections, keyCharInline: keyCharInline,
    keyCharSelection: keyCharSelection, keyCharSelected: keyCharSelected,
    selectKeyChar: selectKeyChar, keyCharProfileCost: keyCharProfileCost,
    keyCharProfileHasPicks: keyCharProfileHasPicks,
    resolvedStats: resolvedStats, resolvedKeywords: resolvedKeywords,
    partialModelEffects: partialModelEffects,
    saveState: saveState, loadState: loadState,
    // share / library round-tripping
    exportState: exportState, hydrate: hydrate, clampAll: clampAll,
  };
})();
