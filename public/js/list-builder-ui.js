/**
 * list-builder-ui.js — DOM rendering for the Countermarch List Builder (v5).
 * Depends on window.LB (list-builder.js). Renders the merged prose-with-controls
 * options panel: each unit profile section is shown as on the faction pages, with
 * interactive controls attached inline to the clauses that carry selections.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function slug(s) {
    return String(s).toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  // "copy / duplicate" icon (outline, inherits currentColor) — sized to match the × button
  var DUP_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="11" height="11" rx="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  // Category display order lives in the engine (LB.categoryOrder) so the builder, the
  // export view and the clipboard writer all group a roster identically.
  function sortedCats(obj) { return LB.categoryOrder(obj); }

  // Section display order + labels
  var SECTIONS = [
    ['unitComposition', 'Unit Composition'],
    ['standardWargear', 'Standard Wargear'],
    ['specialAbilities', 'Special Abilities'],
    ['armourOptions', 'Armour Options'],
    ['wargearOptions', 'Wargear Options'],
    ['forceOrganization', 'Force Organization'],
    ['leader', 'Leader'],
  ];
  var INTERACTIVE = { standardWargear: 1, armourOptions: 1, wargearOptions: 1 };
  var DEFAULT_OPEN = { standardWargear: 1, armourOptions: 1, wargearOptions: 1 };

  // One definition of the statline columns, owned by the engine so the builder, the
  // roster and the Markdown export can never drift apart. Literal fallback only for the
  // case where this file somehow loads first (init below errors on that anyway).
  var STAT_KEYS = (window.LB && window.LB.STAT_KEYS) ||
    ['AP', 'M', 'WS', 'BS', 'I', 'A', 'S', 'T', 'W', 'SV', 'LD'];
  function statLabel(k) { return (window.LB && window.LB.statLabel) ? window.LB.statLabel(k) : k; }

  // ── Left: Unit Browser ───────────────────────────────────────────────────────
  function renderBrowser() {
    var body = document.getElementById('lb-browser-body');
    if (!body) return;
    if (!LB.data.units) { body.innerHTML = '<div class="lb-empty">Select a faction above to browse units.</div>'; return; }

    var cats = {};
    (LB.data.units.units || []).forEach(function (u) {
      var c = u.category || 'Other'; (cats[c] = cats[c] || []).push(u);
    });
    var epicInList = {};
    LB.state.selectedUnits.forEach(function (su) {
      var ud = LB.getUnitData(su.unitName);
      if (ud && (ud.epicHero || (ud.keywords || []).some(function (k) { return k.toLowerCase() === 'epic hero'; }))) epicInList[su.unitName] = true;
    });

    var html = '';
    sortedCats(cats).forEach(function (cat) {
      html += '<div class="lb-cat-group"><div class="lb-cat-header">' + esc(cat) + '</div>';
      cats[cat].forEach(function (u) {
        var comp = (u.options && u.options.composition) || {};
        var minN = (comp.range && comp.range.min) || 1;
        var bp = (LB.modelTypes(u)[0] || {}).basePoints || 0;
        var from = bp * minN;
        var disabled = !!epicInList[u.name];
        html += '<div class="lb-unit-card' + (disabled ? ' lb-unit-card--disabled' : '') + '">';
        html += '<div class="lb-unit-card-name">' + esc(u.name) + '</div>';
        html += '<div class="lb-unit-card-footer">';
        html += from > 0 ? '<span class="lb-unit-pts">' + (minN > 1 ? 'from ' : '') + from + '<span class="lb-pts-label"> pts</span></span>' : '<span></span>';
        html += '<button class="lb-add-btn" data-add="' + esc(u.name) + '"' + (disabled ? ' disabled title="Epic Hero already in army"' : '') + '>+ Add</button>';
        html += '</div></div>';
      });
      html += '</div>';
    });
    body.innerHTML = html || '<div class="lb-empty">No units found.</div>';
  }

  // ── Centre: Army List ────────────────────────────────────────────────────────
  function renderArmyList() {
    var totalEl = document.getElementById('lb-total-display');
    var statusEl = document.getElementById('lb-forceorg-status');
    var body = document.getElementById('lb-list-body');
    if (!body) return;

    var total = LB.calcTotalPoints(), target = LB.state.targetPoints, over = total > target;
    var v = LB.validateForceOrg();

    if (totalEl) {
      totalEl.innerHTML = '<span class="lb-total-pts' + (over ? ' lb-total-pts--over' : '') + '">' + total + '</span>' +
        '<span class="lb-total-sep"> / </span><span class="lb-total-target">' + target + '</span><span class="lb-pts-label"> pts</span>';
    }
    if (statusEl) {
      // Units with compulsory choices still outstanding count against validity too —
      // otherwise the builder reads "valid" for a list the export view flags, and a
      // list with an unarmed model is not a legal one however the slots add up.
      var pending = LB.state.selectedUnits.filter(function (su) { return LB.unitIssues(su).length; }).length;
      if (!v.violations.length && !v.warnings.length && !pending) {
        statusEl.innerHTML = LB.state.selectedUnits.length ? '<span class="lb-status-ok">&#10003; Army valid</span>' : '';
      } else {
        statusEl.innerHTML = v.violations.map(function (x) { return '<span class="lb-status-violation">&#9888; ' + esc(x) + '</span>'; }).join('') +
          v.warnings.map(function (x) { return '<span class="lb-status-warning">&#9432; ' + esc(x) + '</span>'; }).join('') +
          (pending ? '<span class="lb-status-warning">&#9432; ' + pending +
            (pending === 1 ? ' unit has' : ' units have') + ' choices still to make</span>' : '');
      }
    }

    var units = LB.state.selectedUnits;
    if (!units.length) {
      body.innerHTML = '<div class="lb-empty">No units added yet.<br><small>Use the browser on the left to add units.</small></div>';
      return;
    }
    var cats = {};
    units.forEach(function (su) { var ud = LB.getUnitData(su.unitName); var c = (ud && ud.category) || 'Other'; (cats[c] = cats[c] || []).push(su); });

    var html = '';
    sortedCats(cats).forEach(function (cat) {
      html += '<div class="lb-list-cat"><div class="lb-list-cat-header">' + esc(cat) + '</div>';
      cats[cat].forEach(function (su) {
        var sel = su.id === LB.state.selectedUnitId;
        var pts = LB.calcUnitPoints(su);
        var ud = LB.getUnitData(su.unitName);
        var issues = LB.unitIssues(su);
        html += '<div class="lb-list-unit' + (sel ? ' lb-list-unit--selected' : '') + '" data-id="' + su.id + '">';
        html += '<div class="lb-list-unit-main" data-select="' + su.id + '">';
        html += '<div class="lb-list-unit-name">';
        if (su.isWarlord) html += '<span class="lb-warlord-badge" title="Warlord">&#9733;</span>';
        html += esc(su.unitName) + '</div>';
        html += '<div class="lb-list-unit-meta">';
        html += '<span class="lb-model-count">' + esc(modelSummary(su, ud)) + '</span>';
        html += '<span class="lb-unit-pts">' + pts + ' pts</span>';
        html += '</div>';
        if (issues.length) html += '<div class="lb-list-unit-issue">&#9888; ' + esc(issues[0]) + '</div>';
        html += '</div>' +
          '<button class="lb-dup-btn" data-duplicate="' + su.id + '" title="Duplicate" aria-label="Duplicate unit">' + DUP_ICON + '</button>' +
          '<button class="lb-remove-btn" data-remove="' + su.id + '" title="Remove">&#215;</button></div>';
      });
      html += '</div>';
    });
    body.innerHTML = html;
    renderDetachmentTraits(body);
  }

  function modelSummary(su, ud) {
    var mc = su.modelCounts || {};
    var parts = Object.keys(mc).filter(function (k) { return mc[k] > 0; }).map(function (k) { return mc[k] + ' ' + k; });
    var n = LB.totalModels(su);
    return parts.length > 1 ? parts.join(', ') : (n + (n === 1 ? ' model' : ' models'));
  }

  function detachmentTraitsHtml() {
    var dt = LB.data.detachmentTraits;
    if (!dt || !(dt.detachmentTraits || []).length) return '';
    // group by category, preserving document order
    var groups = [], idx = {};
    (dt.detachmentTraits || []).forEach(function (t) {
      var c = t.category || '';
      if (idx[c] === undefined) { idx[c] = groups.length; groups.push({ cat: c, traits: [] }); }
      groups[idx[c]].traits.push(t);
    });
    var vd = LB.validateDetachment();
    var dp = vd.budget != null ? '<span class="lb-dt-dp' + (vd.spent > vd.budget ? ' lb-dt-dp--over' : '') + '">' + vd.spent + ' / ' + vd.budget + ' DP</span>' : '';
    var html = '<div class="lb-dt-section"><div class="lb-dt-header"><span>Detachment Traits</span>' + dp + '</div>';
    groups.forEach(function (g) {
      if (g.cat) html += '<div class="lb-dt-subheader">' + esc(g.cat) + '</div>';
      g.traits.forEach(function (t) {
        var on = LB.state.detachmentTraitsSelected.indexOf(t.traitId) !== -1;
        var disabled = !on && !LB.canSelectTrait(t.traitId);
        html += '<div class="lb-dt-trait' + (on ? ' lb-dt-trait--selected' : '') + (disabled ? ' lb-dt-trait--disabled' : '') + '">';
        html += '<label class="lb-dt-trait-label"><input type="checkbox" data-trait="' + esc(t.traitId) + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '>';
        html += '<span class="lb-dt-trait-name">' + esc(t.name) + '</span>';
        if (t.detachmentPointsCost != null) html += '<span class="lb-dt-cost">' + t.detachmentPointsCost + ' DP</span>';
        html += '</label>';
        var prose = partitionTraitProse(t);
        html += traitChoicesHtml(t, on, prose.prompts);
        if (prose.body) {
          html += '<details class="lb-dt-effects"><summary class="lb-dt-effects-toggle">Show rules</summary>' +
                  '<div class="lb-dt-effects-body">' + prose.body + '</div></details>';
        }
        html += '</div>';
      });
    });
    return html + '</div>';
  }
  // A trait with a sub-selection authors the whole decision as ordinary prose: a
  // prompt paragraph ("Select 1 of the following … :") followed by a bullet list of the
  // options. Both become the picker, so lift them out of the rules text — otherwise the
  // player reads the same eight units twice, once as prose and once as controls.
  // Anything not claimed by a choice group stays in the rules body untouched.
  function partitionTraitProse(t) {
    var out = { prompts: {}, body: t.effectsHtml || '' };
    if (!out.body || !LB.traitChoices(t).length) {
      if (!out.body) out.body = effectsHtml(t.effects);   // pre-effectsHtml data
      return out;
    }
    var box = document.createElement('div');
    box.innerHTML = out.body;

    LB.traitChoices(t).forEach(function (c) {
      var want = {};
      (c.options || []).forEach(function (o) { want[String(o.label).trim().toLowerCase()] = 1; });
      var lis = Array.prototype.filter.call(box.querySelectorAll('li'), function (li) {
        return want[(li.textContent || '').trim().toLowerCase()];
      });
      if (!lis.length) return;                      // prose doesn't list them — leave it alone
      var ul = lis[0].parentNode;
      var sameList = lis.every(function (li) { return li.parentNode === ul; });
      lis.forEach(function (li) { li.parentNode.removeChild(li); });
      if (!sameList || !ul || ul.children.length) return;   // list had other content — keep it
      var prev = ul.previousElementSibling;
      if (prev && prev.tagName === 'P') { out.prompts[c.choiceId] = prev.innerHTML; prev.parentNode.removeChild(prev); }
      ul.parentNode.removeChild(ul);
    });

    out.body = box.innerHTML.trim();
    return out;
  }

  // The picker for a trait's required sub-selections. Shown only once the trait is
  // taken, and outside the "Show rules" accordion — it is a decision the list needs,
  // not reference text.
  function traitChoicesHtml(t, selected, prompts) {
    var chs = LB.traitChoices(t);
    if (!selected || !chs.length) return '';
    var html = '<div class="lb-dt-choices">';
    chs.forEach(function (c) {
      var picked = LB.traitChoice(t.traitId, c.choiceId);
      var need = c.pick || 1, multi = need > 1, owed = picked.length < need;
      var prompt = (prompts && prompts[c.choiceId])
        || esc('Select ' + need + ' of the following:');
      html += '<div class="lb-dt-choice' + (owed ? ' lb-dt-choice--owed' : '') + '">' +
              '<div class="lb-dt-choice-prompt">' + prompt + '</div>';
      (c.options || []).forEach(function (o) {
        var on = picked.indexOf(o.optionId) !== -1;
        var full = !on && multi && picked.length >= need;
        html += '<label class="lb-opt-row lb-opt-row--' + (multi ? 'check' : 'radio') +
          (on ? ' lb-opt-row--sel' : '') + (full ? ' lb-opt-row--dim' : '') + '">' +
          '<input type="' + (multi ? 'checkbox' : 'radio') + '"' +
          (multi ? '' : ' name="lb-dtc-' + esc(t.traitId + '--' + c.choiceId) + '"') +
          ' data-dt-trait="' + esc(t.traitId) + '" data-dt-group="' + esc(c.choiceId) + '"' +
          ' data-dt-option="' + esc(o.optionId) + '"' +
          (on ? ' checked' : '') + (full ? ' disabled' : '') + '>' +
          '<span class="lb-opt-name">' + esc(o.label) + '</span></label>';
      });
      html += '</div>';
    });
    return html + '</div>';
  }

  function renderDetachmentTraits(container) {
    var html = detachmentTraitsHtml();
    if (!html) return;
    container.insertAdjacentHTML('beforeend', html);
    var sec = container.querySelector('.lb-dt-section');
    if (sec) reinitTooltips(sec);   // trait prose carries keyword/weapon/wargear spans
  }
  // Targeted update: refresh the DP counter + each trait's checked/disabled state
  // without rebuilding the section (preserves open "Show rules" accordions, and
  // reconciles a click the engine blocked as over-budget/over-cap/excluded).
  function syncDetachmentTraits() {
    var section = document.querySelector('.lb-dt-section'); if (!section) return;
    var vd = LB.validateDetachment();
    var dpEl = section.querySelector('.lb-dt-dp');
    if (dpEl && vd.budget != null) {
      dpEl.textContent = vd.spent + ' / ' + vd.budget + ' DP';
      dpEl.classList.toggle('lb-dt-dp--over', vd.spent > vd.budget);
    }
    section.querySelectorAll('input[data-trait]').forEach(function (input) {
      var id = input.dataset.trait;
      var on = LB.state.detachmentTraitsSelected.indexOf(id) !== -1;
      var disabled = !on && !LB.canSelectTrait(id);
      input.checked = on; input.disabled = disabled;
      var row = input.closest('.lb-dt-trait');
      if (row) {
        row.classList.toggle('lb-dt-trait--selected', on);
        row.classList.toggle('lb-dt-trait--disabled', disabled);
        syncTraitChoices(row, id, on);
      }
    });
  }
  function traitById(id) {
    var list = ((LB.data.detachmentTraits || {}).detachmentTraits) || [];
    for (var i = 0; i < list.length; i++) if (list[i].traitId === id) return list[i];
    return null;
  }
  // Rebuild just this trait's picker — it appears when the trait is taken and its
  // rows re-render as picks change. Scoped so the "Show rules" accordions elsewhere
  // in the section stay exactly as the player left them.
  function syncTraitChoices(row, traitId, on) {
    var t = traitById(traitId); if (!t || !LB.traitChoices(t).length) return;
    var existing = row.querySelector('.lb-dt-choices');
    var html = traitChoicesHtml(t, on, partitionTraitProse(t).prompts);
    if (!html) { if (existing) existing.parentNode.removeChild(existing); return; }
    if (existing) existing.outerHTML = html;
    else {
      var label = row.querySelector('.lb-dt-trait-label');
      if (label) label.insertAdjacentHTML('afterend', html);
    }
    var fresh = row.querySelector('.lb-dt-choices');
    if (fresh) reinitTooltips(fresh);
  }

  // ── Right: Unit Options (merged prose + controls) ────────────────────────────
  function renderOptions() {
    var titleEl = document.getElementById('lb-options-title');
    var body = document.getElementById('lb-options-body');
    if (!body) return;
    var id = LB.state.selectedUnitId;
    var entry = id && LB.state.selectedUnits.filter(function (u) { return u.id === id; })[0];
    if (!entry) {
      if (titleEl) titleEl.textContent = 'Unit Options';
      body.innerHTML = '<div class="lb-empty">Click a unit in the army list to configure its options.</div>';
      return;
    }
    var u = LB.getUnitData(entry.unitName);
    if (!u) { body.innerHTML = '<div class="lb-empty">Unit data unavailable.</div>'; return; }
    if (titleEl) titleEl.textContent = entry.unitName;
    if (window.AH_REF && window.AH_REF.clearTooltips) window.AH_REF.clearTooltips();

    var html = '<div class="lb-options-fixed">' + renderFixedZone(entry, u) + '</div>';
    // Key characteristics lead: the profile chosen there decides the wargear below it.
    html += '<div class="lb-options-scroll">' + renderKeyCharacteristics(entry, u) +
      renderSections(entry, u) + renderGifts(entry, u) + '</div>';
    body.innerHTML = html;
    reinitTooltips(body);
  }

  function keywordsHtml(keywords) {
    if (!keywords || !keywords.length) return '';
    return '<div class="lb-keywords lb-keywords--tt">' + keywords.map(function (k) {
      return '<span class="keyword" data-term="' + esc(slug(k)) + '" data-type="keyword">' + esc(k) + '</span>';
    }).join('') + '</div>';
  }

  // Renders the (resolved) statline. When `base` is supplied, cells whose value
  // differs from the base profile are marked modified (R1 armour/equipment).
  function renderStatRow(stats, base) {
    stats = stats || {};
    var html = '<div class="lb-statblock-row">';
    STAT_KEYS.forEach(function (k) {
      var val = stats[k] !== undefined && stats[k] !== null ? stats[k] : '—';
      var mod = base && base[k] !== undefined && String(base[k]) !== String(stats[k]);
      html += '<div class="lb-stat-cell' + (mod ? ' lb-stat-cell--mod' : '') + '"><span class="lb-stat-label">' + esc(statLabel(k)) + '</span>' +
        '<span class="lb-stat-value">' + esc(String(val)) + '</span></div>';
    });
    return html + '</div>';
  }

  // The characteristics one partial-cover item moves, relative to the statline row above
  // it — "W 6", "M 5\", I 3, T 7, W 7", "+Stealth". Shared by the builder and the roster.
  function partialDeltaText(rowStats, n) {
    var parts = STAT_KEYS.filter(function (k) { return String(rowStats[k]) !== String(n.stats[k]); })
      .map(function (k) { return k + ' ' + n.stats[k]; });
    (n.keywordsAdded || []).forEach(function (k) { parts.push('+' + k); });
    (n.keywordsRemoved || []).forEach(function (k) { parts.push('−' + k); });
    return parts.join(', ');
  }
  // Footnote for items only some of a model type's models carry, which the single row
  // above cannot show. Suppressed on a type with no models in the unit — that row is a
  // preview of a model the player hasn't fielded, so a "3 of 5 models" count is meaningless.
  function partialNotesHtml(entry, mt, qty) {
    if (qty <= 0) return '';
    var notes = LB.partialModelEffects(entry, mt);
    if (!notes.length) return '';
    var rowStats = LB.resolvedStats(entry, mt);
    return '<div class="lb-partial-notes">' + notes.map(function (n) {
      return '<div class="lb-partial-note">' + n.count + ' of ' + n.of +
        (n.of === 1 ? ' model: ' : ' models: ') +
        '<span class="lb-partial-delta">' + esc(partialDeltaText(rowStats, n)) + '</span>' +
        ' <span class="lb-partial-src">(' + esc(n.name) + ')</span></div>';
    }).join('') + '</div>';
  }

  // Wrap "Sustained Hits N" in the site's keyword span, so a duplicate-weapon note carries
  // the same tooltip the rules pages do. keyword-tooltips.js strips the trailing segment
  // until it finds a match, so sustained-hits-4 and sustained-hits-d31 both land on the
  // base definition.
  function sustainedHtml(text) {
    return esc(text).replace(/Sustained Hits ([^,\s]+)/g, function (m, v) {
      return '<span class="keyword" data-term="sustained-hits-' + esc(slug(v)) +
             '" data-type="keyword">' + m + '</span>';
    });
  }
  // Duplicate melee weapons (R6). A model carrying more than one of the same melee weapon
  // treats them as a single weapon, +1 Attacks and +1 Sustained Hits per pair. It reads as
  // a note rather than a statline change because the bonus belongs to that weapon: the
  // model's other melee weapons must not inherit it.
  // Where the arrangement forces the answer the builder just states it. Where it leaves a
  // choice — the list records how many models took an option, never which — the player
  // assigns it, and the row is shown even at zero: an invisible control on a squad that
  // could pair its weapons would leave the rule undiscoverable for exactly the units it
  // exists to serve. At zero the effect is phrased as what it *would* give.
  function duplicateNotesHtml(entry) {
    var groups = (LB.duplicateGroups ? LB.duplicateGroups(entry) : [])
      .filter(function (g) { return g.models > 0 || g.assignable; });
    if (!groups.length) return '';
    return '<div class="lb-dup-notes">' + groups.map(function (g) {
      var weapon = '<span class="lb-dup-weapon">' + g.copies + '&times; ' + esc(g.name) + '</span>';
      var effect = '<span class="lb-dup-delta">' + esc(g.attacksText) + ', ' +
                   sustainedHtml(g.sustainedText) + '</span>';
      var unit = (g.modelType && g.of !== LB.totalModels(entry)) ? ' ' + esc(g.modelType) : ' model';
      if (!g.assignable) {
        var who = g.of > 1 ? (g.models + ' of ' + g.of + unit + 's') : ('1' + unit);
        return '<div class="lb-dup-note">' + who + ': ' + weapon + ' merged &mdash; ' + effect + '</div>';
      }
      var idle = g.models <= 0;
      return '<div class="lb-dup-note lb-dup-note--assign' + (idle ? ' lb-dup-note--idle' : '') + '">' +
        '<span class="lb-dup-assign">' +
          '<button class="lb-squad-btn" data-dup-key="' + esc(g.key) + '" data-dup-n="' + (g.models - 1) + '"' +
            (g.models <= g.lo ? ' disabled' : '') + '>&#8722;</button>' +
          '<span class="lb-dup-count">' + g.models + '</span>' +
          '<button class="lb-squad-btn" data-dup-key="' + esc(g.key) + '" data-dup-n="' + (g.models + 1) + '"' +
            (g.models >= g.hi ? ' disabled' : '') + '>&#43;</button>' +
        '</span>' +
        '<span class="lb-dup-body">of up to ' + g.hi + unit + (g.hi === 1 ? ' carries ' : 's carry ') +
        weapon + ' &mdash; ' + (idle ? 'would give ' : '') + effect + '</span></div>';
    }).join('') + '</div>';
  }

  function renderFixedZone(entry, u) {
    var opts = LB.unitOptions(u), comp = opts.composition || {};
    var mts = LB.modelTypes(u), N = LB.totalModels(entry);
    var pts = LB.calcUnitPoints(entry);
    var multi = mts.length > 1;
    var variant = LB.isVariant(u);   // R5: mutually-exclusive model lines
    var transform = LB.isTransform(u);   // coupled +1 product = -N source (HWT)
    var html = '<div class="lb-statblock"><div class="lb-statblock-header">';
    html += '<div class="lb-statblock-pts">' + pts + ' <span class="lb-pts-label">pts total</span></div>';
    html += '<div class="lb-statblock-cat">' + esc(u.category || '') + '</div></div>';
    // single-statline units: keywords at the unit level. Multi-statline: per model (below).
    if (!multi) html += keywordsHtml(LB.resolvedKeywords(entry, mts[0]));
    html += '</div>';

    // Composition + per-type statlines
    if (comp.mode === 'tiers' && (comp.tiersRaw || comp.tiers)) {
      var tiers = comp.tiers || (comp.tiersRaw || []).map(function (t, i) { return { label: t }; });
      html += '<div class="lb-section"><div class="lb-section-label">Unit Composition</div><div class="lb-tier-list">';
      tiers.forEach(function (t, i) {
        html += '<label class="lb-tier-opt' + (entry.tier === i ? ' lb-tier-opt--sel' : '') + '">' +
          '<input type="radio" name="lb-tier-' + entry.id + '" data-tier="' + i + '"' + (entry.tier === i ? ' checked' : '') + '>' +
          '<span>' + esc(t.label || ('Option ' + (i + 1))) + '</span></label>';
      });
      html += '</div></div>';
    }
    mts.forEach(function (mt) {
      var cnt = (entry.modelCounts[mt.name] || 0);
      html += '<div class="lb-model-group"><div class="lb-model-group-label">' + esc(mt.name) +
        (mt.basePoints ? ' <span class="lb-mg-pts">' + mt.basePoints + ' pts/model</span>' : '') + '</div>';
      html += renderStatRow(LB.resolvedStats(entry, mt), mt.stats);
      html += partialNotesHtml(entry, mt, cnt);   // items only some models carry
      if (multi) html += keywordsHtml(LB.resolvedKeywords(entry, mt));   // per-model keywords (may differ per type)
      // model-count stepper for range AND multi-statline units (A12)
      if (comp.mode === 'range' || comp.mode === 'multi') {
        var b = LB.modelTypeBounds(u, mt.name, entry);   // entry → dynamic Squad Size Constraints max
        if (b.min !== b.max) {
          // R5: for a variant unit the non-chosen line is locked once the other is in use.
          var otherActive = variant && mts.some(function (m) { return m.name !== mt.name && (entry.modelCounts[m.name] || 0) > 0; });
          var locked = variant && cnt === 0 && otherActive;
          var decDis = variant ? (locked || cnt === 0) : (transform ? cnt <= b.min : false);
          var incDis = variant ? (locked || cnt >= b.max) : (transform ? cnt >= b.max : false);
          html += '<div class="lb-squad-size' + (locked ? ' lb-squad-size--locked' : '') + '"><button class="lb-squad-btn" data-mdec="' + esc(mt.name) + '"' + (decDis ? ' disabled' : '') + '>&#8722;</button>' +
            '<span class="lb-squad-count" data-mcount="' + esc(mt.name) + '">' + cnt + '</span>' +
            '<button class="lb-squad-btn" data-minc="' + esc(mt.name) + '"' + (incDis ? ' disabled' : '') + '>&#43;</button>' +
            '<span class="lb-squad-range">(' + b.min + '–' + b.max + ')</span></div>';
        } else if (transform) {
          // a transform model type whose total is fixed (e.g. Special Weapons Guardsman: 6 − 2×HWT)
          // has no stepper of its own, but its count varies — show it read-only.
          html += '<div class="lb-squad-size lb-squad-size--derived"><span class="lb-squad-count" data-mcount="' + esc(mt.name) + '">' + cnt + '</span>' +
            '<span class="lb-squad-range">in unit</span></div>';
        }
      }
      html += '</div>';
    });
    if (variant) html += '<div class="lb-variant-note">Choose one: ' + esc(mts.map(function (m) { return m.name; }).join(' or ')) + ' — not both.</div>';
    html += duplicateNotesHtml(entry);   // R6: same melee weapon carried more than once

    if ((u.keywords || []).some(function (k) { return k.toLowerCase() === 'leader'; })) {
      html += '<div class="lb-section lb-warlord-section"><label class="lb-warlord-label">' +
        '<input type="checkbox" data-warlord="1"' + (entry.isWarlord ? ' checked' : '') + '>' +
        '<span class="lb-warlord-text">&#9733; Designate as Warlord</span></label></div>';
    }
    // Mount host designator — shown only on eligible host units while a mounting unit
    // (Squadron Commander, Dread Baron, …) is in the army (mirrors the Warlord toggle).
    // The label names whichever mounting unit(s) may use this host, so it is agnostic.
    if (LB.isHostEligible(u.name)) {
      var mnts = (LB.mountUnitsForHost ? LB.mountUnitsForHost(u.name) : []);
      var mlabel = mnts.length ? ('Host a ' + mnts.join(' / ')) : 'Host a mounted unit';
      html += '<div class="lb-section lb-host-section"><label class="lb-host-label">' +
        '<input type="checkbox" data-squadron-host="1"' + (entry.squadronHost ? ' checked' : '') + '>' +
        '<span class="lb-host-text">&#128737; ' + mlabel + '</span></label></div>';
    }
    return html;
  }

  function renderSections(entry, u) {
    var opts = LB.unitOptions(u);
    var byKey = {};
    (opts.sections || []).forEach(function (s) { byKey[s.key] = s; });
    var N = LB.totalModels(entry);
    var html = '';
    SECTIONS.forEach(function (def) {
      var key = def[0], sec = byKey[key];
      if (!sec) return;
      var interactive = INTERACTIVE[key];
      var hasClauses = (sec.clauses || []).length > 0;
      if (!interactive && !(sec.prose && sec.prose.trim())) return;
      if (interactive && !hasClauses && !(sec.prose && sec.prose.trim())) return;

      html += '<details class="lb-profile-section"' + (DEFAULT_OPEN[key] ? ' open' : '') + '>';
      html += '<summary class="lb-profile-section-summary">' + esc(def[1]) + '</summary>';
      html += '<div class="lb-profile-section-body">';
      if (interactive && hasClauses) {
        // compound clauses (a shared compoundGroup) render as one seamless list:
        // the first is the 'head', the rest 'cont' (no prose/divider between them).
        var prevCg = null;
        sec.clauses.forEach(function (cl) {
          var cmp = cl.compoundGroup ? (cl.compoundGroup === prevCg ? 'cont' : 'head') : null;
          prevCg = cl.compoundGroup || null;
          html += renderClause(entry, u, cl, N, cmp);
        });
      } else {
        html += '<div class="lb-profile-prose">' + (sec.prose || '') + '</div>';
      }
      html += '</div></details>';
    });
    return html || '<div class="lb-empty">No options for this unit.</div>';
  }

  // ── Selectable upgrade catalog (Gifts of Chaos) ─────────────────────────────
  function mtByName(u, name) {
    var mts = LB.modelTypes(u);
    for (var i = 0; i < mts.length; i++) if (mts[i].name === name) return mts[i];
    return mts[0];
  }
  // Short human summary of a tier's effect: "+1 A, Khorne, Relentless".
  function giftEffectText(tier) {
    if (!tier) return '';
    var parts = [];
    (tier.modelStats || []).forEach(function (s) {
      var sign = s.op === 'dec' ? '−' : (s.op === 'set' ? '' : '+');
      parts.push(sign + s.value + ' ' + s.char);
    });
    ((tier.keywords && tier.keywords.add) || []).forEach(function (k) { parts.push(k); });
    ((tier.keywords && tier.keywords.remove) || []).forEach(function (k) { parts.push('−' + k); });
    return parts.join(', ');
  }
  function renderGiftOption(entry, u, a, item, mt, modelIdx) {
    var tier = LB.giftTier(item, mt), takeable = !!tier;
    var sel = LB.giftSelection(entry, a, modelIdx);
    var checked = sel.indexOf(item.id) !== -1;
    var dis = !takeable || (sel.length >= a.count && !checked);
    // NB: not esc()'d here — `meta` is escaped once at the point of use below. Escaping
    // twice turned a keyword like `Scout 7"` into `Scout 7&amp;quot;`.
    var meta = takeable
      ? (tier.points + ' pts' + (giftEffectText(tier) ? ' · ' + giftEffectText(tier) : ''))
      : 'n/a for this model';
    var idxAttr = (modelIdx != null) ? ' data-gift-idx="' + modelIdx + '"' : '';
    var html = '<label class="lb-gift-opt' + (checked ? ' lb-gift-opt--sel' : '') + (dis ? ' lb-gift-opt--dis' : '') + '">' +
      '<input type="checkbox" data-gift-id="' + esc(item.id) + '" data-gift-scope="' + esc(a.scope) +
        '" data-gift-mtype="' + esc(a.modelType) + '"' + idxAttr + (checked ? ' checked' : '') + (dis ? ' disabled' : '') + '>' +
      '<span class="lb-gift-name">' + esc(item.name) + '</span>' +
      '<span class="lb-gift-meta">' + esc(meta) + '</span></label>';
    // Rules text for the chosen item (harvested from the docx). Several Paths of the
    // Aspect Shrines have no mechanical effect at all — the prose IS the upgrade, and
    // without it the player cannot tell the options apart.
    if (checked && (item.effectsHtml || (item.effects || []).length)) {
      html += '<div class="lb-kc-fx-wrap">' + kcProseHtml(item) + '</div>';
    }
    return html;
  }
  function giftPreview(entry, u, mt, ids) {
    if (!ids || !ids.length) return '';
    return '<div class="lb-gift-preview">' + renderStatRow(LB.resolvedStats(entry, mt, ids), mt.stats) +
      keywordsHtml(LB.resolvedKeywords(entry, mt, ids)) + '</div>';
  }
  function renderAllowance(entry, u, cat, a) {
    var mt = mtByName(u, a.modelType), items = cat.items || [];
    function optList(modelIdx) { return items.map(function (it) { return renderGiftOption(entry, u, a, it, mt, modelIdx); }).join(''); }
    var html = '<div class="lb-gift-group">';
    if (a.scope === 'unit') {
      // "All <type> … (per model)" only means anything on a squad; on a single-model
      // character (Autarch, Lord) it is noise.
      var many = (entry.modelCounts[a.modelType] || 0) > 1;
      html += '<div class="lb-gift-group-label">' +
        (many ? 'All ' + esc(a.modelType) + ' — choose up to ' + a.count +
                ' <span class="lb-gift-note">(per model)</span>'
              : 'Choose up to ' + a.count) +
        '</div><div class="lb-gift-opts">' + optList(null) + '</div>';
    } else if (a.scope === 'champion') {
      html += '<div class="lb-gift-group-label">Champion — choose up to ' + a.count + '</div>' +
        '<div class="lb-gift-opts">' + optList(null) + '</div>' + giftPreview(entry, u, mt, LB.giftSelection(entry, a));
    } else { // per-model
      var c = entry.modelCounts[a.modelType] || 0;
      html += '<div class="lb-gift-group-label">Each ' + esc(a.modelType) + ' — choose up to ' + a.count + ' per model</div>';
      for (var i = 0; i < c; i++) {
        html += '<div class="lb-gift-model"><div class="lb-gift-model-label">Model ' + (i + 1) + '</div>' +
          '<div class="lb-gift-opts">' + optList(i) + '</div>' + giftPreview(entry, u, mt, LB.giftSelection(entry, a, i)) + '</div>';
      }
    }
    return html + '</div>';
  }
  function renderGifts(entry, u) {
    var cat = LB.unitCatalog(), allowances = LB.unitAllowances(u);
    if (!cat || !allowances.length) return '';
    // A unit that declares the catalog in its own H6 renders it inside that section
    // (with its label and prose) rather than as a second, unexplained block.
    if (LB.keyCharSections(u).some(function (s) { return s.source === 'catalog'; })) return '';
    var html = '<div class="lb-section lb-gifts-zone"><div class="lb-section-label">' + esc(cat.category) + '</div>';
    allowances.forEach(function (a) { html += renderAllowance(entry, u, cat, a); });
    return html + '</div>';
  }

  // The allowance controls for the faction catalog, shared by the stand-alone gifts zone
  // and the key-characteristic section that declares the catalog.
  function catalogAllowancesHtml(entry, u) {
    var cat = LB.unitCatalog(), allowances = LB.unitAllowances(u);
    if (!cat || !allowances.length) return '';
    return allowances.map(function (a) { return renderAllowance(entry, u, cat, a); }).join('');
  }

  // ── Key unit characteristics ────────────────────────────────────────────────
  // Rendered directly beneath the statline and above Standard Wargear, because the
  // choice made here determines the wargear shown below it.
  // "Abilities:" / "Leader:" are authored as their own paragraph. This panel has always
  // shown them as sub-labels rather than body text, so keep that with the rich prose —
  // the shared converter renderer stays generic and the special case lives here, next
  // to the flat-lines fallback that has always done the same thing.
  var KC_SUBLABEL_RE = /^(abilities|special abilities|leader|led by|wargear)\s*:$/i;
  function kcProseHtml(item) {
    if (!item.effectsHtml) return effectsHtml(item.effects);
    var box = document.createElement('div');
    box.innerHTML = item.effectsHtml;
    Array.prototype.slice.call(box.querySelectorAll('p')).forEach(function (p) {
      var t = (p.textContent || '').trim();
      if (!KC_SUBLABEL_RE.test(t)) return;
      var d = document.createElement('div');
      d.className = 'lb-kc-sublabel';
      d.textContent = t.replace(/:$/, '');
      p.parentNode.replaceChild(d, p);
    });
    return box.innerHTML;
  }

  // Fallback renderer for data with no `effectsHtml` — the flat lines are all there is,
  // so bullets are the best guess. Prefer the authored HTML wherever it exists.
  function effectsHtml(effects) {
    if (!effects || !effects.length) return '';
    var html = '', open = false;
    effects.forEach(function (line) {
      var t = String(line).trim();
      if (!t) return;
      // "Abilities:" / "Leader:" arrive as their own line — render them as sub-labels.
      if (/^(abilities|special abilities|leader|led by|wargear)\s*:$/i.test(t)) {
        if (open) { html += '</ul>'; open = false; }
        html += '<div class="lb-kc-sublabel">' + esc(t.replace(/:$/, '')) + '</div>';
        return;
      }
      if (!open) { html += '<ul class="lb-kc-fx">'; open = true; }
      html += '<li>' + esc(t) + '</li>';
    });
    return html + (open ? '</ul>' : '');
  }

  function renderKcProfile(entry, u, sec, pr, N) {
    var selected = LB.keyCharSelected(entry, sec.id, pr.id);
    var single = (sec.select && sec.select.max) === 1;
    var cost = LB.keyCharProfileCost(entry, u, sec, pr);
    var meta = cost ? ((LB.keyCharProfileHasPicks(pr) ? 'from +' : '+') + cost + ' pts')
                    : (LB.keyCharProfileHasPicks(pr) ? 'varies' : 'no extra cost');
    var html = '<div class="lb-kc-opt' + (selected ? ' lb-kc-opt--sel' : '') + '">' +
      '<label class="lb-kc-opt-head">' +
        '<input type="' + (single ? 'radio' : 'checkbox') + '" name="lb-kc-' + esc(entry.id + '-' + sec.id) + '"' +
          ' data-kc-sec="' + esc(sec.id) + '" data-kc-profile="' + esc(pr.id) + '"' +
          (selected ? ' checked' : '') + '>' +
        '<span class="lb-kc-name">' + esc(pr.name) + '</span>' +
        '<span class="lb-kc-meta">' + esc(meta) + '</span>' +
      '</label>';
    if (selected) {
      html += '<div class="lb-kc-body">';
      // the granted wargear: ordinary clauses, so nested picks render as live controls
      (pr.clauses || []).forEach(function (cl) { html += renderClause(entry, u, cl, N, null); });
      if (pr.abilities) html += '<div class="lb-kc-sublabel">Abilities</div>' +
        '<div class="lb-profile-prose">' + pr.abilities + '</div>';
      if (pr.leader) html += '<div class="lb-kc-sublabel">Leader</div>' +
        '<div class="lb-profile-prose">' + pr.leader + '</div>';
      html += '</div>';
    }
    return html + '</div>';
  }

  function renderKeyCharacteristics(entry, u) {
    var secs = LB.keyCharSections(u);
    if (!secs.length) return '';
    var N = LB.totalModels(entry), html = '';
    secs.forEach(function (sec) {
      var need = (sec.select || {}).min || 0;
      var have = LB.keyCharSelection(entry, sec.id).length;
      html += '<details class="lb-profile-section lb-kc-section" open>';
      html += '<summary class="lb-profile-section-summary">' + esc(sec.label) +
        (need ? '<span class="lb-kc-req' + (have >= need ? ' lb-kc-req--ok' : '') + '">required</span>' : '') +
        '</summary><div class="lb-profile-section-body">';
      if (sec.prose) html += '<div class="lb-profile-prose">' + sec.prose + '</div>';
      if (sec.source === 'catalog') {
        // shared faction pool — selection runs through the existing allowance controls.
        // The wrapper is syncGifts' refresh target (see there).
        html += '<div class="lb-kc-catalog">' + catalogAllowancesHtml(entry, u) + '</div>';
      } else {
        html += '<div class="lb-kc-opts">';
        (sec.profiles || []).forEach(function (pr) { html += renderKcProfile(entry, u, sec, pr, N); });
        html += '</div>';
      }
      html += '</div></details>';
    });
    return html;
  }

  // Display name of a weapon modifier, from the faction's wargear data.
  function modName(itemId) {
    var fw = ((LB.data.factionWargear || {}).wargearItems) || [];
    for (var i = 0; i < fw.length; i++) if (fw[i].itemId === itemId) return fw[i].name;
    return itemId;
  }
  /**
   * @param {Object} p       — an option or one of its `parts`
   * @param {Object} optInfo — optional player-chosen modifier covering some/all of the
   *                           weapon's instances (see optModInfo), or null
   */
  function refSpan(p, optInfo) {
    var pre = '';
    if (p.qty && p.qty !== 1) pre += esc(p.qty + 'x ');
    // Compulsory modifiers baked into the weapon's name (Twin-linked, Accursed …).
    var mods = p.modifiers || [];
    mods.forEach(function (m) {
      pre += '<span class="wargear-ref" data-wargear="' + esc(m) + '">' + esc(modName(m)) + '</span> ';
    });
    var cls = p.kind === 'weapon' ? 'weapon-ref' : 'wargear-ref',
        attr = p.kind === 'weapon' ? 'data-weapon' : 'data-wargear';
    // data-mods is authoritative for the tooltip; without it ref-tooltips.js falls
    // back to inferring modifiers from the adjacent wargear-refs rendered above.
    var extra = '';
    if (p.kind === 'weapon') {
      if (mods.length) extra += ' data-mods="' + esc(mods.join(',')) + '"';
      if (optInfo) {
        extra += ' data-opt-mods="' + esc(optInfo.mods.join(',')) + '"' +
                 ' data-opt-applied="' + optInfo.applied + '"' +
                 ' data-opt-total="' + optInfo.total + '"';
      }
    }
    return pre + '<span class="' + cls + '" ' + attr + '="' + esc(p.ref.split(':')[1]) + '"' + extra + '>' +
      esc(p.name) + '</span>';
  }
  function optLabel(o, optInfo) {
    // composite options render each component (weapon/wargear → own tooltip) and any
    // plain text (connectors / "Nx" / uncosted labels) separately, via `parts`.
    if (o.parts && o.parts.length) {
      return o.parts.map(function (p) { return p.text != null ? esc(p.text) : refSpan(p, optInfo); }).join('');
    }
    return refSpan(o, optInfo);   // fallback for data without parts
  }
  // The Relic-Weapon-style upgrade currently bought for an option's weapon, and how
  // many of its equipped instances carry it — a partial count makes the tooltip show
  // the untouched and upgraded statlines side by side.
  function optModInfo(entry, u, cl, o) {
    var relicCl = LB.relicModifier(u);
    if (!relicCl || !LB.relicEligible(relicCl, o)) return null;
    var total = LB.optEquipped(entry, u, cl, o);
    if (total <= 0) return null;
    var applied = (entry.relic && entry.relic[cl.id + '::' + o.ref]) || 0;
    if (applied <= 0) return null;
    var mref = relicCl.modifierRef ? relicCl.modifierRef.split(':')[1]
                                   : slug(relicCl.modifier || 'Relic Weapon');
    return { mods: [mref], applied: applied, total: total };
  }
  // An option's cost isn't always its flat `points`: a statline-banded item (Adrenal
  // Glands) is priced by the taking model's own statline, so the label is resolved
  // against the clause's model type(s) whenever that context is available.
  function ptsText(p, plus) {
    if (p == null) return 'see rules';
    if (p === 0) return 'free';
    return (plus ? '+' : '') + p + ' pts';
  }
  function optPoints(o, entry, u, cl) {
    if (entry) return LB.optDisplayPoints(entry, u, cl, o);
    return o.points == null ? null : o.points;      // sub-selection options: flat cost only
  }
  function optPts(o, entry, u, cl) {
    return '<span class="lb-opt-pts">' + ptsText(optPoints(o, entry, u, cl), true) + '</span>';
  }
  // points label for fixed (already-included) standard wargear — no leading "+"
  function fixedPts(o, entry, u, cl) {
    return '<span class="lb-opt-pts">' + ptsText(optPoints(o, entry, u, cl), false) + '</span>';
  }

  // Control type is a function of (clause, unit) only — NOT of the current model
  // count or selections — so it stays stable across edits (enables targeted updates).
  function controlType(u, cl) {
    if (cl.op === 'modifier' && !cl.appliesTo) return 'counter';   // relic-style flat upgrade
    if (cl.op === 'modifier' && cl.appliesTo) return 'stepper';    // per-weapon upgrade (A4)
    if (cl.scope && cl.scope.who === 'unitPool') return 'stepper'; // finite unit-level count
    var isUnit = cl.scope && cl.scope.who === 'unit';
    var pickMax = (cl.pick && cl.pick.max != null) ? cl.pick.max : null;
    if (isUnit) return pickMax === 1 ? 'radio' : 'checkbox';
    var single = ((u.options && u.options.composition) || {}).mode === 'single';
    if (single) {
      if (pickMax === 1 && (cl.options || []).length > 1) return 'radio';
      // repeatable "up to N" (N>1, not distinct) → stepper, so the same option can be
      // taken more than once (e.g. 2× Multi-melta). Distinct/"1 of each" stays checkbox.
      if (pickMax != null && pickMax > 1 && !(cl.pick && cl.pick.distinct)) return 'stepper';
      return 'checkbox';
    }
    return 'stepper';                                              // multi-capable: who:each/count/ratio
  }
  // A weapon clause fully replaced by a suppressing item (every targeted model has
  // it) — its cap is 0, so it renders non-interactive (folded into `gated`).
  function isSuppressed(entry, u, cl) {
    return LB.isSuppressibleClause(u, cl) && LB.suppressedModelCount(entry, u) > 0 && LB.clauseSubCap(entry, u, cl) <= 0;
  }
  // Note when a weapon clause is (partly) replaced by a suppressing item (Paragon
  // Warsuit). Fully suppressed → the options are already capped to 0 (disabled).
  function suppressNote(entry, u, cl, N) {
    if (!LB.isSuppressibleClause(u, cl)) return '';
    var supp = LB.suppressedModelCount(entry, u);
    if (supp <= 0) return '';
    var msg = supp >= N
      ? 'Replaced by the model’s wargear upgrade — select weapons in its panel above.'
      : supp + ' model(s) use a wargear upgrade and select weapons there instead.';
    return '<div class="lb-clause-suppressed">' + esc(msg) + '</div>';
  }
  function requiresNote(cl) {
    var r = cl.scope && cl.scope.requires; if (!r) return '';
    if (r.armour) return 'Requires ' + r.armour + ' Armour';
    if (r.weaponKeyword) return 'Requires a ' + r.weaponKeyword + ' weapon';
    if (r.weaponIn) return 'Requires ' + r.weaponIn.join(' or ');
    return '';
  }
  function clauseCapHtml(entry, u, cl, type) {
    var N = LB.totalModels(entry);
    if (cl.op === 'modifier' && cl.appliesTo)
      return '<span class="lb-clause-cap">' + LB.clauseTotal(entry, cl.id) + '/' + LB.equippedCount(entry, u, cl.appliesTo.weapon) + '</span>';
    if (cl.scope && cl.scope.who === 'unitPool') {
      var mx = (cl.pick && cl.pick.max != null) ? cl.pick.max : null;
      return '<span class="lb-clause-cap">' + LB.clauseTotal(entry, cl.id) + (mx != null ? '/' + mx : '') + ' in unit</span>';
    }
    if (cl.scope && cl.scope.who === 'unit') {
      var pm = (cl.pick && cl.pick.max != null) ? cl.pick.max : null;
      return '<span class="lb-clause-cap">all models' + (pm && pm > 1 ? ' &middot; up to ' + pm : '') + '</span>';
    }
    if (LB.isSlotPooled(cl)) return '<span class="lb-clause-cap">' + LB.slotUsed(entry, u, LB.slotOf(cl)) + '/' + N + ' assigned</span>';
    if (cl.scope && (cl.scope.who === 'count' || cl.scope.who === 'ratio')) return '<span class="lb-clause-cap">up to ' + LB.clauseSubCap(entry, u, cl) + '</span>';
    return '';
  }
  // One sub-selection group (radio if pick.max===1, else checkbox) for one equipped
  // model instance. modelIdx is '0' for instance-items (shared) or 0..k-1 per model.
  // Relic-Weapon (or other item.relicUpgrade) toggle beneath a picked, eligible
  // sub-selection weapon — the sub-selection analogue of renderRelicPanel.
  function subRelicRow(entry, u, cl, o, modelIdx, group, so) {
    var ru = LB.itemRelicUpgrade(o.ref);
    if (!ru || !LB.subRelicEligible(u, ru, so)) return '';
    var on = LB.subRelicMarked(entry, cl.id, o.ref, modelIdx, group.id, so.ref);
    var mref = ru.modifierRef ? ru.modifierRef.split(':')[1] : slug(ru.modifier || 'Relic Weapon');
    var name = '<span class="wargear-ref" data-wargear="' + esc(mref) + '">' + esc(ru.modifier || 'Relic Weapon') + '</span>';
    var subPer = LB.modifierMarginalCost(so.ref, mref, ru.pointsPerWeapon);
    var pts = '<span class="lb-opt-pts">' + (subPer != null ? '+' + subPer + ' pts' : 'see rules') + '</span>';
    return '<div class="lb-nested lb-relic lb-subrelic"><label class="lb-opt-row lb-opt-row--check' + (on ? ' lb-opt-row--sel' : '') + '">' +
      '<input type="checkbox" data-subrelic-clause="' + esc(cl.id) + '" data-subrelic-opt="' + esc(o.ref) +
      '" data-subrelic-model="' + modelIdx + '" data-subrelic-group="' + esc(group.id) + '" data-subrelic-ref="' + esc(so.ref) + '"' + (on ? ' checked' : '') + '>' +
      '<span class="lb-opt-name">' + name + '</span>' + pts + '</label></div>';
  }
  function renderSubGroup(entry, u, cl, o, subs, group, modelIdx) {
    var picks = LB.nestedPicks(entry, cl.id, o.ref, modelIdx, group.id);
    var single = group.pick && group.pick.max === 1;
    var optional = !(group.pick && group.pick.min >= 1);
    var name = 'lb-sub-' + esc(cl.id + '::' + o.ref + '::' + modelIdx + '::' + group.id);
    var head = group.label || (single ? 'Select 1 of the following' : 'Select from the following');
    var html = '<div class="lb-sub-group"><div class="lb-sub-group-label">' + esc(head) +
      (optional ? ' <span class="lb-sub-tag">optional</span>' : '') + '</div>';
    var ru = LB.itemRelicUpgrade(o.ref);
    (group.options || []).forEach(function (so) {
      var on = picks.indexOf(so.ref) !== -1;
      // A sub-selection relic is a per-instance toggle, so it covers all (1 of 1).
      var srInfo = null;
      if (on && ru && LB.subRelicEligible(u, ru, so) &&
          LB.subRelicMarked(entry, cl.id, o.ref, modelIdx, group.id, so.ref)) {
        srInfo = { mods: [ru.modifierRef ? ru.modifierRef.split(':')[1]
                                         : slug(ru.modifier || 'Relic Weapon')],
                   applied: 1, total: 1 };
      }
      html += '<label class="lb-opt-row lb-opt-row--' + (single ? 'radio' : 'check') + (on ? ' lb-opt-row--sel' : '') + '">' +
        '<input type="' + (single ? 'radio' : 'checkbox') + '" name="' + name + '"' +
        ' data-sub-clause="' + esc(cl.id) + '" data-sub-opt="' + esc(o.ref) + '" data-sub-model="' + modelIdx + '"' +
        ' data-sub-group="' + esc(group.id) + '" data-sub-ref="' + esc(so.ref) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="lb-opt-name">' + optLabel(so, srInfo) + '</span>' + optPts(so) + '</label>';
      if (on) html += subRelicRow(entry, u, cl, o, modelIdx, group, so);   // relic toggle under the picked weapon
    });
    return html + '</div>';
  }
  // Full sub-selection panel under a selected item: an instance-count selector +
  // one shared group set (instance-items, e.g. Sponsons), or one group set per
  // equipped model (per-model divergence, e.g. a squad of Paragon Warsuits).
  // Read-only panel of weapons auto-included with an item (no choice), e.g. Wings.
  function renderIncludedWeapons(o) {
    var inc = LB.itemIncludedWeapons(o.ref); if (!inc || !inc.length) return '';
    return '<div class="lb-nested lb-included">' + inc.map(function (w) {
      return '<div class="lb-opt-row lb-opt-row--fixed"><span class="lb-opt-name">' + optLabel(w) + '</span>' +
        '<span class="lb-opt-pts">' + (w.points != null ? '+' + w.points + ' pts &middot; included' : 'included') + '</span></div>';
    }).join('') + '</div>';
  }
  function renderSubSelections(entry, u, cl, o) {
    var subs = LB.itemSubSelections(o.ref); if (!subs) return '';
    var inst = LB.itemInstances(o.ref);
    var html = '<div class="lb-nested lb-sub">';
    if (inst) {
      var count = LB.instanceCountFor(entry, cl.id, o.ref);
      html += '<div class="lb-sub-instances"><span class="lb-sub-instances-label">' + esc(inst.label || 'Count') + '</span>';
      inst.counts.forEach(function (c) {
        html += '<label class="lb-inst-opt' + (c === count ? ' lb-inst-opt--sel' : '') + '">' +
          '<input type="radio" name="lb-inst-' + esc(cl.id + '::' + o.ref) + '" data-inst-clause="' + esc(cl.id) +
          '" data-inst-opt="' + esc(o.ref) + '" data-inst-count="' + c + '"' + (c === count ? ' checked' : '') + '><span>' + c + '</span></label>';
      });
      html += '</div><div class="lb-sub-note">Identical selections applied to all ' + count + ' ' + esc(inst.label || '') + '.</div>';
      subs.forEach(function (g) { html += renderSubGroup(entry, u, cl, o, subs, g, '0'); });
    } else {
      var k = LB.equippedInstances(entry, u, cl, o.ref);
      for (var i = 0; i < k; i++) {
        if (k > 1) html += '<div class="lb-sub-model-label">Model ' + (i + 1) + '</div>';
        subs.forEach(function (g) { html += renderSubGroup(entry, u, cl, o, subs, g, i); });
      }
    }
    return html + '</div>';
  }
  // Relic Weapon sub-control beneath an equipped eligible weapon. Checkbox when a
  // single instance is equipped; stepper when several copies are (e.g. 2 models with
  // the same weapon under "any model can be upgraded to a Relic Weapon").
  function renderRelicPanel(entry, cl, o, relicCl, cap) {
    var key = cl.id + '::' + o.ref;
    var cur = (entry.relic && entry.relic[key]) || 0;
    var mref = relicCl.modifierRef ? relicCl.modifierRef.split(':')[1] : slug(relicCl.modifier || 'Relic Weapon');
    // Real per-instance cost: upgrading a Twin-linked weapon past S8 re-tiers its
    // Twin-linked surcharge, so this can exceed the modifier's flat pointsPerWeapon.
    var per = LB.modifierMarginalCost(o.ref, mref, relicCl.pointsPerWeapon);
    var name = '<span class="wargear-ref" data-wargear="' + esc(mref) + '">' + esc(relicCl.modifier || 'Relic Weapon') + '</span>';
    var pts = '<span class="lb-opt-pts">' + (per != null ? '+' + per + ' pts' + (cap > 1 ? ' each' : '') : 'see rules') + '</span>';
    if (cap <= 1) {
      return '<div class="lb-nested lb-relic"><label class="lb-opt-row lb-opt-row--check' + (cur > 0 ? ' lb-opt-row--sel' : '') + '">' +
        '<input type="checkbox" data-relic-clause="' + cl.id + '" data-relic-opt="' + esc(o.ref) + '"' + (cur > 0 ? ' checked' : '') + '>' +
        '<span class="lb-opt-name">' + name + '</span>' + pts + '</label></div>';
    }
    return '<div class="lb-nested lb-relic"><div class="lb-opt-row lb-opt-row--step">' +
      '<span class="lb-opt-name">' + name + '</span>' + pts +
      '<span class="lb-stepper"><button class="lb-step-btn" data-relic-clause="' + cl.id + '" data-relic-opt="' + esc(o.ref) + '" data-relic-d="-1"' + (cur === 0 ? ' disabled' : '') + '>&#8722;</button>' +
      '<span class="lb-step-count">' + cur + '</span>' +
      '<button class="lb-step-btn" data-relic-clause="' + cl.id + '" data-relic-opt="' + esc(o.ref) + '" data-relic-d="1"' + (cur >= cap ? ' disabled' : '') + '>&#43;</button></span></div></div>';
  }
  function relicUnder(entry, u, cl, o) {           // relic panel HTML for an option, or ''
    var relicCl = LB.relicModifier(u);
    if (!relicCl || !LB.relicEligible(relicCl, o)) return '';
    var eq = LB.optEquipped(entry, u, cl, o);
    return eq > 0 ? renderRelicPanel(entry, cl, o, relicCl, eq) : '';
  }
  function renderFixedBody(entry, u, cl) {
    var rep = LB.replacedStandardWeapons(entry, u), N = LB.totalModels(entry);
    return (cl.options || []).map(function (o) {
      // fully replaced by a sub-selection ("…replace its Bolt Pistol with…") → struck out
      if (N > 0 && (rep[String(o.name).trim().toLowerCase()] || 0) >= N)
        return '<div class="lb-opt-row lb-opt-row--fixed lb-opt-row--replaced"><span class="lb-opt-name">' + optLabel(o) +
          '</span><span class="lb-opt-pts lb-opt-replaced-note">replaced</span></div>';
      return '<div class="lb-opt-row lb-opt-row--fixed"><span class="lb-opt-name">' +
        optLabel(o, optModInfo(entry, u, cl, o)) + '</span>' +
        fixedPts(o, entry, u, cl) + '</div>' + relicUnder(entry, u, cl, o);
    }).join('');
  }

  // Requirement affordance for a weapon the current armour/mount excludes (R2).
  // Always emitted for weapon options (empty when available) so syncOptions can
  // toggle it in place.
  function availReqHtml(o, unavail) {
    if (o.kind !== 'weapon') return '';
    var txt = unavail ? 'needs ' + (LB.weaponAvailabilityList(o.name) || []).join(', ') : '';
    return '<span class="lb-opt-req lb-opt-req--avail">' + esc(txt) + '</span>';
  }

  function renderOptionRow(entry, u, cl, o, type) {
    var cur = (entry.sel[cl.id] || {})[o.ref] || 0;
    var cap = LB.optionCap(entry, u, cl, o.ref);
    var key = cl.id + '::' + o.ref;
    var unavail = o.kind === 'weapon' && !LB.weaponAvailable(o.name, LB.governingToken(entry, u));
    // blocked: the wargear group cap is used up, or no statline band covers these models
    var capFull = cur === 0 && (LB.unitCapRoom(entry, u, o) <= 0 || !LB.bandTakeable(entry, u, cl, o));
    var unavailCls = unavail ? ' lb-opt-row--unavail' : '';
    var dimCls = capFull ? ' lb-opt-row--dim' : '';
    var req = availReqHtml(o, unavail);
    var oi = optModInfo(entry, u, cl, o);
    var rowHtml;
    if (type === 'radio') {
      rowHtml = '<label class="lb-opt-row lb-opt-row--radio' + (cur > 0 ? ' lb-opt-row--sel' : '') + unavailCls + dimCls + '" data-row="' + esc(key) + '">' +
        '<input type="radio" name="lb-r-' + cl.id + '" data-radio="' + cl.id + '" data-ref="' + esc(o.ref) + '"' + (cur > 0 ? ' checked' : '') + (unavail || capFull ? ' disabled' : '') + '>' +
        '<span class="lb-opt-name">' + optLabel(o, oi) + '</span>' + req + optPts(o, entry, u, cl) + '</label>';
    } else if (type === 'checkbox') {
      var dis = (cur === 0 && cap <= 0) || unavail || capFull;
      rowHtml = '<label class="lb-opt-row lb-opt-row--check' + (cur > 0 ? ' lb-opt-row--sel' : '') + (dis && !unavail ? ' lb-opt-row--dim' : '') + unavailCls + '" data-row="' + esc(key) + '">' +
        '<input type="checkbox" data-check="' + cl.id + '" data-ref="' + esc(o.ref) + '"' + (cur > 0 ? ' checked' : '') + (dis ? ' disabled' : '') + '>' +
        '<span class="lb-opt-name">' + optLabel(o, oi) + '</span>' + req + optPts(o, entry, u, cl) + '</label>';
    } else {
      rowHtml = '<div class="lb-opt-row lb-opt-row--step' + (cur > 0 ? ' lb-opt-row--sel' : '') + unavailCls + dimCls + '" data-row="' + esc(key) + '">' +
        '<span class="lb-opt-name">' + optLabel(o, oi) + '</span>' + req + optPts(o, entry, u, cl) +
        '<span class="lb-stepper"><button class="lb-step-btn" data-opt="' + cl.id + '" data-ref="' + esc(o.ref) + '" data-d="-1"' + (cur === 0 ? ' disabled' : '') + '>&#8722;</button>' +
        '<span class="lb-step-count">' + cur + '</span>' +
        '<button class="lb-step-btn" data-opt="' + cl.id + '" data-ref="' + esc(o.ref) + '" data-d="1"' + (cur >= cap || unavail || capFull ? ' disabled' : '') + '>&#43;</button></span></div>';
    }
    // auto-included weapons (Wings → Wing Barbs, Combi-Bolter → Boltgun) shown read-only
    // when the item is selected. Ahead of the sub-selection panel: on a combi weapon the
    // included weapon is the thing being added to, so it reads before the choice it takes.
    if (LB.itemIncludedWeapons(o.ref) && cur > 0) rowHtml += renderIncludedWeapons(o);
    // sub-selection panel appears when an item with subSelections is selected
    if (LB.itemSubSelections(o.ref) && cur > 0) rowHtml += renderSubSelections(entry, u, cl, o);
    // Relic Weapon upgrade appears under the selected eligible weapon
    rowHtml += relicUnder(entry, u, cl, o);
    return rowHtml;
  }

  function renderClause(entry, u, cl, N, cmp) {
    var type = controlType(u, cl);
    // cmp: 'head'/'cont' for compound clauses that render as one merged list (no divider
    // after head, no prose/gap before cont) — see convert_options _split_compound.
    var cmpCls = cmp === 'head' ? ' lb-clause--cmp-head' : cmp === 'cont' ? ' lb-clause--cmp-cont' : '';
    var html = '<div class="lb-clause' + cmpCls + '" data-clause="' + cl.id + '">';
    // fixed clauses: the row shows the item name itself, so the prose line would just
    // duplicate it — suppress it. Other clauses keep their instruction prose.
    if (cl.prose && cl.op !== 'fixed') html += '<div class="lb-clause-prose">' + cl.prose + '</div>';

    if (cl.op === 'fixed') {
      return html + '<div class="lb-clause-fixed">' + renderFixedBody(entry, u, cl) + '</div></div>';
    }

    if (type === 'counter') {
      // "Any weapon ... can be upgraded as a Relic Weapon" — informational only here;
      // the actual per-weapon toggles appear under each equipped eligible weapon.
      var mref = cl.modifierRef ? cl.modifierRef.split(':')[1] : slug(cl.modifier || 'Relic Weapon');
      var styled = '<span class="wargear-ref" data-wargear="' + esc(mref) + '">' + esc(cl.modifier || 'Relic Weapon') + '</span>';
      var prose = (cl.prose || '').split(esc(cl.modifier)).join(styled);   // tooltip-enable the modifier name
      return html + '<div class="lb-relic-note">' + prose + '</div></div>';
    }

    var gated = (!!(cl.scope && cl.scope.requires) && LB.requiresCap(entry, u, cl) <= 0) || isSuppressed(entry, u, cl);
    // compound clauses convey their "1 of each" via the shared prose, so drop the per-clause cap meta
    var note = requiresNote(cl), capHtml = cmp ? '' : clauseCapHtml(entry, u, cl, type);
    if (note || capHtml) {
      html += '<div class="lb-clause-meta">' + capHtml +
        (note ? '<span class="lb-clause-req' + (gated ? ' lb-clause-req--unmet' : '') + '">' + esc(note) + '</span>' : '') + '</div>';
    }
    html += suppressNote(entry, u, cl, N);
    html += '<div class="lb-opt-list' + (gated ? ' lb-opt-list--gated' : '') + '">';
    (cl.options || []).forEach(function (o) { html += renderOptionRow(entry, u, cl, o, type); });
    return html + '</div></div>';
  }

  // Targeted update of the options panel in place (no innerHTML rebuild) — preserves
  // scroll position, open accordions, and hover tooltips (fixes the scroll-jump + pin).
  function syncOptions(entry, u) {
    var body = document.getElementById('lb-options-body'); if (!body) return;
    var gToken = LB.governingToken(entry, u);   // current armour/mount profile (R2)
    // does any item's sub-selection replace a standard weapon? → fixed clauses need
    // re-rendering on pick changes so the "replaced" strike-through tracks both ways.
    var anyReplaces = LB.clauses(u).some(function (c) {
      return (c.options || []).some(function (o) { var s = LB.itemSubSelections(o.ref); return s && s.some(function (g) { return g.replaces; }); });
    });
    var ph = body.querySelector('.lb-statblock-pts');
    if (ph) ph.innerHTML = LB.calcUnitPoints(entry) + ' <span class="lb-pts-label">pts total</span>';
    LB.modelTypes(u).forEach(function (mt) {
      var cc = body.querySelector('[data-mcount="' + esc(mt.name) + '"]');
      if (cc) cc.textContent = entry.modelCounts[mt.name] || 0;
    });
    LB.clauses(u).forEach(function (cl) {
      var clEl = body.querySelector('.lb-clause[data-clause="' + cl.id + '"]'); if (!clEl) return;
      var type = controlType(u, cl);
      var capEl = clEl.querySelector('.lb-clause-cap');
      if (capEl) { var t = document.createElement('div'); t.innerHTML = clauseCapHtml(entry, u, cl, type); var nc = t.querySelector('.lb-clause-cap'); if (nc) capEl.innerHTML = nc.innerHTML; }
      var gated = (!!(cl.scope && cl.scope.requires) && LB.requiresCap(entry, u, cl) <= 0) || isSuppressed(entry, u, cl);
      var list = clEl.querySelector('.lb-opt-list'); if (list) list.classList.toggle('lb-opt-list--gated', gated);
      var reqEl = clEl.querySelector('.lb-clause-req'); if (reqEl) reqEl.classList.toggle('lb-clause-req--unmet', gated);
      var sel = entry.sel[cl.id] || {};
      // clauses with combi/relic sub-controls re-render structurally (panels appear/update)
      var relicCl = LB.relicModifier(u);
      var hasRelic = !!relicCl && (cl.options || []).some(function (o) { return LB.relicEligible(relicCl, o); });
      if (cl.op === 'fixed') {
        if (hasRelic || anyReplaces) { var fb = clEl.querySelector('.lb-clause-fixed'); if (fb) { fb.innerHTML = renderFixedBody(entry, u, cl); reinitTooltips(fb); } }
        return;
      }
      if (hasRelic || (cl.options || []).some(function (o) { return LB.itemSubSelections(o.ref) || LB.itemIncludedWeapons(o.ref); })) {
        if (list) { list.innerHTML = (cl.options || []).map(function (o) { return renderOptionRow(entry, u, cl, o, type); }).join(''); reinitTooltips(list); }
        return;
      }
      if (type === 'counter') {
        var row0 = clEl.querySelector('[data-row="' + cl.id + '::__count"]'); if (!row0) return;
        var cnt = sel.__count || 0;
        row0.querySelector('.lb-step-count').textContent = cnt;
        var d0 = row0.querySelector('[data-d="-1"]'); if (d0) d0.disabled = cnt === 0;
        return;
      }
      (cl.options || []).forEach(function (o) {
        var row = clEl.querySelector('[data-row="' + esc(cl.id + '::' + o.ref) + '"]'); if (!row) return;
        var cur = sel[o.ref] || 0, cap = LB.optionCap(entry, u, cl, o.ref);
        var unavail = o.kind === 'weapon' && !LB.weaponAvailable(o.name, gToken);
        // blocked: wargear group cap used up, or no statline band covers these models
        var capFull = cur === 0 && (LB.unitCapRoom(entry, u, o) <= 0 || !LB.bandTakeable(entry, u, cl, o));
        row.classList.toggle('lb-opt-row--sel', cur > 0);
        row.classList.toggle('lb-opt-row--unavail', unavail);
        // a banded item reprices when the unit's model mix changes — keep its label live
        var ptsEl = row.querySelector('.lb-opt-pts');
        if (ptsEl) ptsEl.textContent = ptsText(LB.optDisplayPoints(entry, u, cl, o), true);
        var reqEl = row.querySelector('.lb-opt-req--avail');
        if (reqEl) reqEl.textContent = unavail ? 'needs ' + (LB.weaponAvailabilityList(o.name) || []).join(', ') : '';
        if (type === 'stepper') {
          row.querySelector('.lb-step-count').textContent = cur;
          row.querySelector('[data-d="-1"]').disabled = cur === 0;
          row.querySelector('[data-d="1"]').disabled = cur >= cap || unavail || capFull;
          row.classList.toggle('lb-opt-row--dim', capFull);
        } else {
          var input = row.querySelector('input');
          if (input) { input.checked = cur > 0; input.disabled = type === 'checkbox' ? ((cur === 0 && cap <= 0) || unavail || capFull) : (unavail || capFull); }
          if (type === 'checkbox') row.classList.toggle('lb-opt-row--dim', ((cur === 0 && cap <= 0) || capFull) && !unavail);
          else row.classList.toggle('lb-opt-row--dim', capFull);
        }
      });
    });
  }

  // Targeted update of the centre panel totals/status/per-unit rows (preserves
  // the detachment-traits accordions, which a full list re-render would collapse).
  function updateArmyTotals() {
    var totalEl = document.getElementById('lb-total-display');
    var statusEl = document.getElementById('lb-forceorg-status');
    var total = LB.calcTotalPoints(), target = LB.state.targetPoints, over = total > target;
    var v = LB.validateForceOrg();
    if (totalEl) totalEl.innerHTML = '<span class="lb-total-pts' + (over ? ' lb-total-pts--over' : '') + '">' + total + '</span>' +
      '<span class="lb-total-sep"> / </span><span class="lb-total-target">' + target + '</span><span class="lb-pts-label"> pts</span>';
    if (statusEl) statusEl.innerHTML = (!v.violations.length && !v.warnings.length)
      ? (LB.state.selectedUnits.length ? '<span class="lb-status-ok">&#10003; Army valid</span>' : '')
      : v.violations.map(function (x) { return '<span class="lb-status-violation">&#9888; ' + esc(x) + '</span>'; }).join('') +
        v.warnings.map(function (x) { return '<span class="lb-status-warning">&#9432; ' + esc(x) + '</span>'; }).join('');
    LB.state.selectedUnits.forEach(function (su) {
      var row = document.querySelector('.lb-list-unit[data-id="' + su.id + '"]'); if (!row) return;
      var p = row.querySelector('.lb-unit-pts'); if (p) p.textContent = LB.calcUnitPoints(su) + ' pts';
      var ud = LB.getUnitData(su.unitName);
      var nameEl = row.querySelector('.lb-list-unit-name');
      if (nameEl) nameEl.innerHTML = (su.isWarlord ? '<span class="lb-warlord-badge" title="Warlord">&#9733;</span>' : '') + esc(su.unitName);
      var mc = row.querySelector('.lb-model-count'); if (mc) mc.textContent = modelSummary(su, ud);
      var issues = LB.unitIssues(su), main = row.querySelector('.lb-list-unit-main'), issueEl = row.querySelector('.lb-list-unit-issue');
      if (issues.length) {
        if (!issueEl && main) { issueEl = document.createElement('div'); issueEl.className = 'lb-list-unit-issue'; main.appendChild(issueEl); }
        if (issueEl) issueEl.innerHTML = '&#9888; ' + esc(issues[0]);
      } else if (issueEl) issueEl.remove();
    });
  }
  // Re-render the fixed (non-scrolling) zone so the resolved statline + keyword
  // chips reflect the current armour/equipment (R1). The zone holds no scroll or
  // accordion state, so a full swap is safe; the scrollable options are updated
  // separately by syncOptions.
  function syncStatblock(entry, u) {
    var fixed = document.querySelector('.lb-options-fixed'); if (!fixed) return;
    fixed.innerHTML = renderFixedZone(entry, u);
    reinitTooltips(fixed);
  }
  // Re-render the gifts zone (checked/at-cap states + per-instance statline previews).
  // Full swap of a self-contained, always-open zone → no accordion state to preserve.
  function syncGifts(entry, u) {
    // Two possible homes: the stand-alone gifts zone (a unit whose catalog access comes
    // only from the workbook allowance) or the key-characteristic section that declares
    // the catalog in the unit's own H6. Refresh whichever is present — missing this is
    // what leaves a just-toggled item rendered as unselected.
    var zone = document.querySelector('.lb-gifts-zone');
    if (zone) {
      var t = document.createElement('div'); t.innerHTML = renderGifts(entry, u);
      var nz = t.querySelector('.lb-gifts-zone');
      zone.innerHTML = nz ? nz.innerHTML : '';
      reinitTooltips(zone);
      return;
    }
    var kz = document.querySelector('.lb-kc-catalog'); if (!kz) return;
    kz.innerHTML = catalogAllowancesHtml(entry, u);
    reinitTooltips(kz);
  }
  function refreshInUnit(id) {
    var e = cur(id); if (!e) return;
    var u = LB.getUnitData(e.unitName);
    syncStatblock(e, u); syncOptions(e, u); syncGifts(e, u); updateArmyTotals();
  }

  function reinitTooltips(el) {
    if (window.__ahAttachTooltips) {
      var k = el.querySelectorAll('span.keyword[data-term]'); if (k.length) window.__ahAttachTooltips(k);
    }
    if (window.AH_REF && LB.data.units && LB.data.units.weapons)
      window.AH_REF.initWeaponRefs(el, LB.data.units.weapons,
        (LB.data.factionWargear || {}).wargearItems);
    // Catalog items (Paths of the Aspect Shrines, Gifts of Chaos) are deliberately kept
    // out of wargearItems so they can't be resolved as ordinary, separately-priced
    // wargear — but they are still referenced by wargear-ref spans, so the tooltip
    // lookup gets both lists.
    if (window.AH_REF && LB.data.factionWargear && LB.data.factionWargear.wargearItems) {
      window.AH_REF.initWargearRefs(el, LB.data.factionWargear.wargearItems
        .concat(LB.data.factionWargear.catalogItems || []));
    }
  }

  // ── Render all ───────────────────────────────────────────────────────────────
  function renderAll() { renderBrowser(); renderArmyList(); renderOptions(); }

  // ── Events ───────────────────────────────────────────────────────────────────
  function onBrowserClick(e) {
    var b = e.target.closest('[data-add]'); if (!b || b.disabled) return;
    LB.addUnit(b.dataset.add); renderAll();
  }
  function onListClick(e) {
    var r = e.target.closest('[data-remove]'); if (r) { LB.removeUnit(r.dataset.remove); renderAll(); return; }
    var d = e.target.closest('[data-duplicate]'); if (d) { LB.duplicateUnit(d.dataset.duplicate); renderAll(); return; }
    var s = e.target.closest('[data-select]'); if (s) { LB.selectUnit(s.dataset.select); renderAll(); return; }
  }
  function onListChange(e) {
    var t = e.target.closest('[data-trait]');
    var c = e.target.closest('[data-dt-option]');
    if (!t && !c) return;
    if (t && t.tagName === 'INPUT') LB.selectDetachmentTrait(t.dataset.trait, t.checked);
    // A sub-selection decides which of the trait's rows are live, so it moves the same
    // resolved keywords/stats a trait toggle does — same refresh path.
    if (c && c.tagName === 'INPUT') {
      LB.setTraitChoice(c.dataset.dtTrait, c.dataset.dtGroup, c.dataset.dtOption, c.checked);
    }
    syncDetachmentTraits();   // reconciles blocked selections + budget/cap disabling
    // trait effects change resolved keywords/stats of affected units → refresh the open unit (R4)
    var sid = LB.state.selectedUnitId;
    if (sid) { var se = cur(sid); if (se) syncStatblock(se, LB.getUnitData(se.unitName)); }
    updateArmyTotals();       // targeted — keeps the trait accordions open
  }
  function onOptionsClick(e) {
    var id = LB.state.selectedUnitId; if (!id) return;
    var step = e.target.closest('[data-opt]');
    if (step) { LB.adjustOption(id, step.dataset.opt, step.dataset.ref, parseInt(step.dataset.d, 10)); refreshInUnit(id); return; }
    var mod = e.target.closest('[data-modclause]');
    if (mod) { LB.adjustModifierCount(id, mod.dataset.modclause, parseInt(mod.dataset.d, 10)); refreshInUnit(id); return; }
    var rstep = e.target.closest('[data-relic-d]');
    if (rstep) { LB.setRelic(id, rstep.dataset.relicClause, rstep.dataset.relicOpt, parseInt(rstep.dataset.relicD, 10)); refreshInUnit(id); return; }
    var mdec = e.target.closest('[data-mdec]');
    if (mdec) { var en = cur(id); LB.setModelTypeCount(id, mdec.dataset.mdec, (en.modelCounts[mdec.dataset.mdec] || 0) - 1); refreshInUnit(id); return; }
    var minc = e.target.closest('[data-minc]');
    if (minc) { var en2 = cur(id); LB.setModelTypeCount(id, minc.dataset.minc, (en2.modelCounts[minc.dataset.minc] || 0) + 1); refreshInUnit(id); return; }
    // R6 — how many models of a squad pair up their duplicate melee weapon
    var dup = e.target.closest('[data-dup-key]');
    if (dup) { LB.setDuplicateAssignment(id, dup.dataset.dupKey, parseInt(dup.dataset.dupN, 10)); refreshInUnit(id); return; }
    // toggle-off radios (clicking the already-selected radio clears it)
    var radio = e.target.closest('input[type="radio"][data-radio]');
    if (radio) {
      var en3 = cur(id), s = en3.sel[radio.dataset.radio] || {};
      if (s[radio.dataset.ref]) { LB.setRadioOption(id, radio.dataset.radio, radio.dataset.ref); refreshInUnit(id); return; }
    }
    // toggle-off a selected sub-selection radio (change doesn't fire on re-click)
    var sradio = e.target.closest('input[type="radio"][data-sub-clause]');
    if (sradio) {
      var d = sradio.dataset;
      var picks = LB.nestedPicks(cur(id), d.subClause, d.subOpt, d.subModel, d.subGroup);
      if (picks[0] === d.subRef) { LB.setNestedPick(id, d.subClause, d.subOpt, d.subModel, d.subGroup, d.subRef); refreshInUnit(id); return; }
    }
  }
  function onOptionsChange(e) {
    var id = LB.state.selectedUnitId; if (!id) return;
    var w = e.target.closest('[data-warlord]'); if (w) { LB.setWarlord(id, w.checked); updateArmyTotals(); return; }
    var sh = e.target.closest('[data-squadron-host]'); if (sh) { LB.setSquadronHost(id, sh.checked); updateArmyTotals(); return; }
    var tier = e.target.closest('[data-tier]'); if (tier) { LB.setTier(id, parseInt(tier.dataset.tier, 10)); renderOptions(); updateArmyTotals(); return; }
    // Key characteristic: a profile switch changes which clauses exist, so the whole
    // options panel is rebuilt rather than refreshed in place.
    var kc = e.target.closest('[data-kc-profile]'); if (kc && kc.tagName === 'INPUT') {
      LB.selectKeyChar(id, kc.dataset.kcSec, kc.dataset.kcProfile);
      renderOptions(); renderArmyList(); updateArmyTotals(); return;
    }
    var radio = e.target.closest('[data-radio]'); if (radio && radio.tagName === 'INPUT') { LB.setRadioOption(id, radio.dataset.radio, radio.dataset.ref); refreshInUnit(id); return; }
    var gift = e.target.closest('[data-gift-id]'); if (gift && gift.tagName === 'INPUT') {
      var gu = LB.getUnitData(cur(id).unitName), gd = gift.dataset;
      var a = LB.unitAllowances(gu).filter(function (x) { return x.scope === gd.giftScope && x.modelType === gd.giftMtype; })[0];
      if (a) { LB.toggleGift(id, a, gd.giftId, gd.giftIdx != null ? parseInt(gd.giftIdx, 10) : null); refreshInUnit(id); }
      return;
    }
    var check = e.target.closest('[data-check]'); if (check && check.tagName === 'INPUT') {
      LB.adjustOption(id, check.dataset.check, check.dataset.ref, check.checked ? 1 : -1); refreshInUnit(id); return;
    }
    var srel = e.target.closest('[data-subrelic-clause]'); if (srel && srel.tagName === 'INPUT') {
      var sd = srel.dataset;
      LB.setSubRelic(id, sd.subrelicClause, sd.subrelicOpt, sd.subrelicModel, sd.subrelicGroup, sd.subrelicRef, srel.checked);
      refreshInUnit(id); return;
    }
    var sub = e.target.closest('[data-sub-clause]'); if (sub && sub.tagName === 'INPUT') {
      var d = sub.dataset;
      LB.setNestedPick(id, d.subClause, d.subOpt, d.subModel, d.subGroup, d.subRef); refreshInUnit(id); return;
    }
    var inst = e.target.closest('[data-inst-clause]'); if (inst && inst.tagName === 'INPUT') {
      LB.setInstanceCount(id, inst.dataset.instClause, inst.dataset.instOpt, parseInt(inst.dataset.instCount, 10)); refreshInUnit(id); return;
    }
    var relic = e.target.closest('input[data-relic-clause]'); if (relic) {
      LB.setRelic(id, relic.dataset.relicClause, relic.dataset.relicOpt, relic.checked ? 1 : -1); refreshInUnit(id); return;
    }
  }
  function cur(id) { return LB.state.selectedUnits.filter(function (u) { return u.id === id; })[0]; }

  // ── Faction & battle size ────────────────────────────────────────────────────
  function onFactionChange(e) {
    var slug = e.target.value; LB.setFaction(slug);
    // Changing faction empties the list, so it is no longer the saved entry it was
    // loaded from — unlink it rather than let a later Save overwrite that entry.
    _libraryId = null;
    if (slug) LB.loadFaction(slug).then(renderAll); else renderAll();
  }
  function updateBattleButtons() {
    var c = document.getElementById('lb-battle-sizes'); if (!c) return;
    c.querySelectorAll('[data-battle-size]').forEach(function (b) {
      b.classList.toggle('lb-size-btn--active', parseInt(b.dataset.battleSize, 10) === LB.state.targetPoints);
    });
    var p = document.getElementById('lb-pts-value'); if (p) p.textContent = LB.state.targetPoints;
  }
  function onBattleClick(e) {
    var adj = e.target.closest('[data-pts-adj]');
    if (adj) { LB.setTargetPoints(Math.max(0, LB.state.targetPoints + parseInt(adj.dataset.ptsAdj, 10))); updateBattleButtons(); renderAll(); return; }
    var p = e.target.closest('[data-battle-size]');
    if (p) { LB.setTargetPoints(parseInt(p.dataset.battleSize, 10)); updateBattleButtons(); renderAll(); }
  }

  // ── Share, export and the saved-list library ─────────────────────────────────
  // The list a tab is working on lives in sessionStorage (per tab). These controls
  // move it outward: into a link, into a printable roster, or onto the localStorage
  // shelf that every tab shares.

  var EXPORT_PATH = '/list-export';
  var _libraryId = null;   // the saved entry this draft is linked to, if any

  function noteMsg(msg, kind) {
    var el = document.getElementById('lb-action-note'); if (!el) return;
    el.hidden = false;
    el.className = 'lb-action-note' + (kind ? ' lb-action-note--' + kind : '');
    el.textContent = msg;
    clearTimeout(noteMsg._t);
    noteMsg._t = setTimeout(function () { el.hidden = true; }, 4000);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text) ? null : Promise.reject(); });
    }
    return legacyCopy(text) ? Promise.resolve() : Promise.reject();
  }
  // execCommand path for non-secure contexts (plain http on a LAN address, say).
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select();
      var good = document.execCommand('copy');
      document.body.removeChild(ta);
      return good;
    } catch (e) { return false; }
  }

  function hasList() {
    if (!LB.state.faction) { noteMsg('Select a faction first.', 'warn'); return false; }
    if (!LB.state.selectedUnits.length) { noteMsg('Add some units first.', 'warn'); return false; }
    return true;
  }

  // The tab has to be opened synchronously, while the click is still the reason the
  // code is running — opening it after the await would be treated as a pop-up and
  // blocked. It is parked on about:blank and pointed at the list once the URL is known.
  function openBlankTab() {
    var w = window.open('about:blank', '_blank');
    if (w) { try { w.opener = null; } catch (e) {} }
    return w;
  }
  function sendTabTo(w, url) {
    if (w) w.location.replace(url); else window.open(url, '_blank');
  }

  function onShare() {
    if (!hasList()) return;
    var tab = openBlankTab();
    AH_SHARE.buildShareUrl(EXPORT_PATH, LB.exportState()).then(function (res) {
      sendTabTo(tab, res.url);
      return copyToClipboard(res.url).then(function () {
        noteMsg(res.short
          ? 'Short link copied — anyone with it can open this list.'
          : 'Couldn’t shorten the link, so the full-length one was copied instead.',
          res.short ? 'ok' : 'warn');
      }, function () {
        noteMsg(res.short ? 'Short link opened in a new tab.' : 'Full-length link opened in a new tab.',
                res.short ? 'ok' : 'warn');
      });
    }).catch(function () {
      if (tab) tab.close();
      noteMsg('Could not create a share link.', 'warn');
    });
  }

  function onViewRoster() {
    if (!hasList()) return;
    var tab = openBlankTab();
    AH_SHARE.buildShareUrl(EXPORT_PATH, LB.exportState()).then(function (res) {
      sendTabTo(tab, res.url);
      if (!res.short) noteMsg('Couldn’t shorten the link — the roster opened on a full-length one.', 'warn');
    }).catch(function () {
      if (tab) tab.close();
      noteMsg('Could not open the roster.', 'warn');
    });
  }

  function onCopyMarkdown() {
    if (!hasList()) return;
    copyToClipboard(LB.toMarkdown()).then(function () {
      noteMsg('List copied as Markdown.', 'ok');
    }).catch(function () { noteMsg('Could not copy the list.', 'warn'); });
  }

  function onNewList() {
    if (LB.state.selectedUnits.length &&
        !window.confirm('Start a new list? The list in this tab will be cleared.')) return;
    _libraryId = null;
    LB.hydrate({ faction: LB.state.faction, targetPoints: LB.state.targetPoints,
                 listName: '', selectedUnits: [], detachmentTraitsSelected: [] });
    syncListName();
    renderAll();
    noteMsg('Started a new list.', 'ok');
  }

  function syncListName() {
    var input = document.getElementById('lb-list-name');
    if (input) input.value = LB.state.listName || '';
  }

  // ── Library drawer ───────────────────────────────────────────────────────────
  function toggleLibrary() {
    var drawer = document.getElementById('lb-library'),
        btn = document.getElementById('lb-lists');
    if (!drawer) return;
    var open = drawer.hidden;
    drawer.hidden = !open;
    if (btn) btn.setAttribute('aria-expanded', String(open));
    if (open) renderLibrary();
  }

  function renderLibrary() {
    var body = document.getElementById('lb-library-body'); if (!body) return;
    if (!AH_LIBRARY.available()) {
      body.innerHTML = '<div class="lb-empty">This browser is blocking local storage, so lists cannot be saved here. Use <strong>Share</strong> to keep a link instead.</div>';
      return;
    }
    var entries = AH_LIBRARY.list();
    if (!entries.length) {
      body.innerHTML = '<div class="lb-empty">No saved lists yet.<br><small>Use “Save current” to keep the list in this tab.</small></div>';
      return;
    }
    body.innerHTML = entries.map(function (e) {
      var when = new Date(e.savedAt || 0).toLocaleDateString();
      return '<div class="lb-lib-row' + (e.id === _libraryId ? ' lb-lib-row--current' : '') + '" data-lib-id="' + esc(e.id) + '">' +
        '<button class="lb-lib-main" data-lib-load="' + esc(e.id) + '" title="Load this list into this tab">' +
          '<span class="lb-lib-name">' + esc(e.name) + '</span>' +
          '<span class="lb-lib-meta">' + esc(e.factionTitle || e.faction || '') + ' &middot; ' +
            (e.points != null ? e.points + ' pts' : '') + ' &middot; ' + esc(when) + '</span>' +
        '</button>' +
        '<button class="lb-lib-btn" data-lib-rename="' + esc(e.id) + '" title="Rename">Rename</button>' +
        '<button class="lb-lib-btn lb-lib-btn--danger" data-lib-delete="' + esc(e.id) + '" title="Delete">&#215;</button>' +
        '</div>';
    }).join('');
  }

  function currentMeta() {
    var s = LB.listSummary();
    return { name: s.listName || 'Untitled List', faction: s.faction, factionTitle: s.factionTitle,
             points: s.totalPoints, targetPoints: s.targetPoints, units: s.units.length };
  }

  function onSaveCurrent() {
    if (!hasList()) return;
    var linked = _libraryId && AH_LIBRARY.get(_libraryId) ? _libraryId : null;
    AH_LIBRARY.save(currentMeta(), LB.exportState(), linked).then(function (res) {
      if (!res.ok) { noteMsg(res.error, 'warn'); return; }
      _libraryId = res.id;
      renderLibrary();
      noteMsg(linked ? 'Saved list updated.' : 'List saved.', 'ok');
    });
  }

  function onLibraryClick(ev) {
    var loadBtn = ev.target.closest('[data-lib-load]');
    if (loadBtn) { loadSaved(loadBtn.dataset.libLoad); return; }

    var renameBtn = ev.target.closest('[data-lib-rename]');
    if (renameBtn) {
      var entry = AH_LIBRARY.get(renameBtn.dataset.libRename); if (!entry) return;
      var name = window.prompt('Rename this list:', entry.name);
      if (name == null) return;
      AH_LIBRARY.rename(entry.id, name);
      if (entry.id === _libraryId) { LB.setListName(name); syncListName(); }
      renderLibrary();
      return;
    }

    var delBtn = ev.target.closest('[data-lib-delete]');
    if (delBtn) {
      var e2 = AH_LIBRARY.get(delBtn.dataset.libDelete); if (!e2) return;
      if (!window.confirm('Delete “' + e2.name + '”? This cannot be undone.')) return;
      AH_LIBRARY.remove(e2.id);
      if (e2.id === _libraryId) _libraryId = null;
      renderLibrary();
      noteMsg('List deleted.', 'ok');
    }
  }

  function loadSaved(id) {
    if (LB.state.selectedUnits.length &&
        !window.confirm('Load this saved list? It will replace the list in this tab.')) return;
    AH_LIBRARY.load(id).then(function (state) {
      if (!state) { noteMsg('That saved list could not be read.', 'warn'); return; }
      return applyExternalState(state).then(function () {
        _libraryId = id;
        renderLibrary();
        noteMsg('Loaded “' + (LB.state.listName || 'Untitled List') + '”.', 'ok');
      });
    });
  }

  /* Adopt a list that came from outside this tab (share link or saved entry): load its
     faction data first, then hydrate — hydrate re-clamps against the CURRENT rules, so
     it can only report what changed if the data it is checking against is loaded. */
  function applyExternalState(state) {
    var slug = state.faction;
    return Promise.resolve(slug ? LB.loadFaction(slug) : null).then(function () {
      var report = LB.hydrate(state);
      var sel = document.getElementById('lb-faction-select');
      if (sel && slug) sel.value = slug;
      updateBattleButtons();
      syncListName();
      renderAll();
      if (report.notes.length) {
        noteMsg('Loaded, but the rules have changed since: ' + report.notes[0] +
                (report.notes.length > 1 ? ' (+' + (report.notes.length - 1) + ' more)' : ''), 'warn');
      }
      return report;
    });
  }

  function wireActions() {
    var on = function (id, ev, fn) {
      var el = document.getElementById(id); if (el) el.addEventListener(ev, fn);
    };
    on('lb-share', 'click', onShare);
    on('lb-view', 'click', onViewRoster);
    on('lb-copy-md', 'click', onCopyMarkdown);
    on('lb-lists', 'click', toggleLibrary);
    on('lb-new', 'click', onNewList);
    on('lb-save-as', 'click', onSaveCurrent);
    on('lb-library-body', 'click', onLibraryClick);
    on('lb-list-name', 'input', function () { LB.setListName(this.value); });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    if (typeof LB === 'undefined') { console.error('[LB UI] list-builder.js must load first'); return; }
    LB.loadFactionList();
    var sel = document.getElementById('lb-faction-select');
    if (sel) {
      sel.innerHTML = '<option value="">— Select faction —</option>' +
        (LB.data.factions || []).map(function (f) { return '<option value="' + esc(f.slug) + '">' + esc(f.title) + '</option>'; }).join('');
    }
    var bs = document.getElementById('lb-battle-sizes');
    if (bs) {
      var h = '<div class="lb-pts-adjuster"><button class="lb-pts-adj-btn" data-pts-adj="-10">&#8722;10</button>' +
        '<div class="lb-pts-current"><span class="lb-pts-value" id="lb-pts-value">' + (LB.state.targetPoints || 1000) + '</span><span class="lb-pts-label-sm">pts</span></div>' +
        '<button class="lb-pts-adj-btn" data-pts-adj="10">+10</button></div><div class="lb-size-presets">' +
        LB.BATTLE_SIZES.map(function (b) { return '<button class="lb-size-btn" data-battle-size="' + b.points + '">' + esc(b.label) + '</button>'; }).join('') + '</div>';
      bs.innerHTML = h;
    }

    // A share link takes precedence over this tab's saved draft — following a link
    // should show the list in the link. The fragment is then stripped so a later
    // refresh reloads the (by then edited) draft rather than resetting to the link.
    var token = window.AH_SHARE && AH_SHARE.readToken();
    var loadedFromLink = false;
    if (token) {
      try {
        var shared = await AH_SHARE.decode(token);
        await applyExternalState(shared);
        history.replaceState(null, '', window.location.pathname + window.location.search);
        loadedFromLink = true;
      } catch (err) {
        noteMsg('That share link could not be read, so your own list was kept.', 'warn');
      }
    }

    if (!loadedFromLink) {
      var had = LB.loadState();
      if (had && LB.state.faction) { if (sel) sel.value = LB.state.faction; await LB.loadFaction(LB.state.faction); }
      updateBattleButtons();
      syncListName();
      renderAll();
    }

    var bb = document.getElementById('lb-browser-body'); if (bb) bb.addEventListener('click', onBrowserClick);
    var lb = document.getElementById('lb-list-body'); if (lb) { lb.addEventListener('click', onListClick); lb.addEventListener('change', onListChange); }
    var ob = document.getElementById('lb-options-body'); if (ob) { ob.addEventListener('click', onOptionsClick); ob.addEventListener('change', onOptionsChange); }
    if (sel) sel.addEventListener('change', onFactionChange);
    if (bs) bs.addEventListener('click', onBattleClick);
    wireActions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
