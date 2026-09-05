/**
 * list-export.js — renders the read-only army list at /list-export.
 *
 * The list arrives in the URL fragment. This page decodes it, loads the faction's
 * JSON exactly as the builder does, hydrates the engine, and renders LB.listSummary().
 * Pricing therefore comes from the same engine the builder uses — the export can't
 * drift from what the player saw while building.
 *
 * Depends on: list-builder.js (LB), list-share.js (AH_SHARE), ref-tooltips.js.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function $(id) { return document.getElementById(id); }

  var statusEl, sheetEl, actionsEl, token = null;

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.className = 'lx-status' + (kind ? ' lx-status--' + kind : '');
    statusEl.innerHTML = msg;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function slugOf(text) {
    return String(text).toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  // An item as a tooltip-capable span, matching the markup the faction pages use so
  // ref-tooltips.js can resolve it without any export-specific handling. Items an
  // option carries with it (a combi-weapon's sub-weapon, a mount's included weapon)
  // are nested, so the roster shows what belongs to what.
  function itemHtml(i) {
    var slug = i.ref ? String(i.ref).split(':')[1] : null;
    if (slug) slug = slug.split('#')[0];
    var isWeapon = i.kind === 'weapon';
    var cls = isWeapon ? 'weapon-ref' : 'wargear-ref';
    var attr = isWeapon ? 'data-weapon' : 'data-wargear';
    var mods = (i.modRefs && i.modRefs.length) ? ' data-mods="' + esc(i.modRefs.join(',')) + '"' : '';
    var label = slug
      ? '<span class="' + cls + '" ' + attr + '="' + esc(slug) + '"' + mods + '>' + esc(i.name) + '</span>'
      : esc(i.name);
    var suffix = (i.mods && i.mods.length) ? ' <span class="lx-item-mod">(' + esc(i.mods.join(', ')) + ')</span>' : '';
    var h = '<li class="lx-item"><span class="lx-qty">' + i.qty + '&times;</span> ' + label + suffix;
    if (i.children && i.children.length) {
      h += '<ul class="lx-subitems">' + i.children.map(itemHtml).join('') + '</ul>';
    }
    return h + '</li>';
  }

  // Resolved statline(s): armour swaps, gifts and detachment traits are already applied,
  // and a cell that moved off the book value is marked. Row labels appear only when the
  // unit fields more than one kind of model.
  function statTableHtml(l) {
    if (!l.statlines.length) return '';
    var keys = LB.STAT_KEYS, multi = l.statlines.length > 1;
    var h = '<div class="lx-stats-wrap"><table class="lx-stats"><thead><tr>';
    if (multi) h += '<th class="lx-stats-model"></th>';
    keys.forEach(function (k) { h += '<th>' + esc(LB.statLabel(k)) + '</th>'; });
    h += '</tr></thead><tbody>';
    l.statlines.forEach(function (sl) {
      h += '<tr>';
      if (multi) h += '<td class="lx-stats-model">' + sl.qty + '&times; ' + esc(sl.modelType) + '</td>';
      keys.forEach(function (k) {
        var v = sl.stats[k], b = sl.base ? sl.base[k] : undefined;
        var moved = b !== undefined && b !== null && String(b) !== String(v);
        h += '<td' + (moved ? ' class="lx-stat--mod"' : '') + '>' +
             esc(v === undefined || v === null ? '—' : String(v)) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    return h + partialNotesHtml(l, multi);
  }

  // Items only some models carry can't be a table row — the row is the whole model type —
  // so they print beneath it as footnotes, matching the builder. On paper this is the only
  // record that e.g. two of six Ogryn are T7 W7, so it belongs on the roster, not just on screen.
  function partialNotesHtml(l, multi) {
    var keys = LB.STAT_KEYS, lines = [];
    l.statlines.forEach(function (sl) {
      (sl.partial || []).forEach(function (n) {
        var parts = keys.filter(function (k) { return String(sl.stats[k]) !== String(n.stats[k]); })
          .map(function (k) { return k + ' ' + n.stats[k]; });
        (n.keywordsAdded || []).forEach(function (k) { parts.push('+' + k); });
        (n.keywordsRemoved || []).forEach(function (k) { parts.push('−' + k); });
        lines.push('<li>' + (multi ? esc(sl.modelType) + ' — ' : '') + n.count + ' of ' + n.of +
          (n.of === 1 ? ' model: ' : ' models: ') + esc(parts.join(', ')) +
          ' <span class="lx-partial-src">(' + esc(n.name) + ')</span></li>');
      });
    });
    return lines.length ? '<ul class="lx-partial-notes">' + lines.join('') + '</ul>' : '';
  }

  function keywordsHtml(keywords) {
    if (!keywords || !keywords.length) return '';
    return '<div class="lx-keywords">' + keywords.map(function (k) {
      return '<span class="keyword" data-term="' + esc(slugOf(k)) + '" data-type="keyword">' + esc(k) + '</span>';
    }).join('') + '</div>';
  }

  // Duplicate melee weapons (R6). The merged statline itself is printed in the weapon
  // appendix; this footnote says how many models are holding it, which the appendix — one
  // deduplicated table for the whole army — cannot. On paper this is the only record that
  // e.g. three of six Warriors swing their Talons at A+4.
  function duplicateNotesHtml(l) {
    if (!l.duplicates || !l.duplicates.length) return '';
    return '<ul class="lx-dup-notes">' + l.duplicates.map(function (g) {
      var who = g.of > 1 ? (g.models + ' of ' + g.of + ' models') : '1 model';
      var sh = esc(g.sustainedText).replace(/Sustained Hits ([^,\s]+)/g, function (m, v) {
        return '<span class="keyword" data-term="sustained-hits-' + esc(slugOf(v)) +
               '" data-type="keyword">' + m + '</span>';
      });
      return '<li>' + esc(who) + ': ' + g.copies + '&times; ' + esc(g.name) +
             ' merged &mdash; <span class="lx-dup-delta">' + esc(g.attacksText) + ', ' + sh +
             '</span></li>';
    }).join('') + '</ul>';
  }

  // A catalog item's rules arrive as an array of lines where a short line ending in a
  // colon ("Abilities:", "Leader:") is a heading for the lines beneath it.
  function effectsHtml(effects) {
    return (effects || []).map(function (t) {
      var s = String(t).trim();
      if (/:$/.test(s) && s.length < 40) return '<p class="lx-rule-sublabel">' + esc(s) + '</p>';
      return '<p>' + esc(s) + '</p>';
    }).join('');
  }

  // A detachment trait's full rules text. The roster is played from, so it carries the
  // whole rule — with the site's keyword/weapon/wargear spans, and therefore the same
  // tooltips the faction pages have.
  //
  // Where the trait put a choice to the player, the options NOT taken are dropped: the
  // one that was is already printed beside the trait name, and a roster listing all
  // eight Aspect Warriors units would read as though every one of them qualified.
  function traitRulesHtml(t) {
    var html = t.html || effectsHtml(t.effects);
    if (!html) return '';
    if ((t.choices || []).length) {
      var box = document.createElement('div');
      box.innerHTML = html;
      t.choices.forEach(function (c) {
        var want = {};
        (c.options || []).forEach(function (o) { want[String(o.label).trim().toLowerCase()] = 1; });
        var lis = Array.prototype.filter.call(box.querySelectorAll('li'), function (li) {
          return want[(li.textContent || '').trim().toLowerCase()];
        });
        if (!lis.length) return;
        var ul = lis[0].parentNode;
        var sameList = lis.every(function (li) { return li.parentNode === ul; });
        lis.forEach(function (li) { li.parentNode.removeChild(li); });
        if (!sameList || !ul || ul.children.length) return;
        // The prompt ("Select 1 of the following…") goes with its list: the choice it
        // introduces is already answered beside the trait name. Same rule the builder
        // applies when it turns those lines into the picker.
        var prev = ul.previousElementSibling;
        if (prev && prev.tagName === 'P') prev.parentNode.removeChild(prev);
        ul.parentNode.removeChild(ul);
      });
      html = box.innerHTML.trim();
    }
    return '<div class="lx-trait-rules">' + html + '</div>';
  }

  // Prose rules carried onto the roster. The section prose is already HTML with the
  // site's weapon/wargear/keyword spans in it, so injecting it verbatim gives the
  // roster the same tooltips the faction pages have.
  function rulesHtml(l) {
    if (!l.rules || !l.rules.length) return '';
    return l.rules.map(function (r) {
      var body = '';
      if (r.html) body = r.html;
      else if (r.blocks) {
        body = r.blocks.map(function (b) {
          return '<div class="lx-rule-block"><div class="lx-rule-name">' + esc(b.name) + '</div>' +
                 (b.html ? b.html : effectsHtml(b.effects)) + '</div>';
        }).join('');
      }
      if (!body) return '';
      return '<div class="lx-rule"><div class="lx-rule-label">' + esc(r.label) + '</div>' +
             '<div class="lx-rule-body">' + body + '</div></div>';
    }).join('');
  }

  function unitHtml(l) {
    var h = '<div class="lx-unit">';
    h += '<div class="lx-unit-head">';
    h += '<span class="lx-unit-name">' + esc(l.unitName) + '</span>';
    if (l.isWarlord) h += '<span class="lx-warlord" title="Warlord">&#9733; Warlord</span>';
    if (l.totalModels > 1) h += '<span class="lx-models">' + l.totalModels + ' models</span>';
    h += '<span class="lx-unit-pts">' + fmt(l.points) + ' pts</span>';
    h += '</div>';

    h += statTableHtml(l);
    h += duplicateNotesHtml(l);
    h += keywordsHtml(l.keywords);

    l.characteristics.forEach(function (c) {
      h += '<div class="lx-characteristic"><span class="lx-char-label">' +
           esc(c.section || 'Characteristic') + '</span> ' + esc(c.name) + '</div>';
    });

    var items = l.items.filter(function (i) { return i.group !== 'characteristics'; });
    if (items.length) h += '<ul class="lx-items">' + items.map(itemHtml).join('') + '</ul>';
    h += rulesHtml(l);
    if (l.issues && l.issues.length) {
      h += '<div class="lx-unit-issue">&#9888; ' + esc(l.issues[0]) + '</div>';
    }
    return h + '</div>';
  }

  // One deduplicated table of every weapon in the army. Tooltips carry these stats on
  // screen but cannot on paper, which is what this is for.
  function weaponAppendixHtml(weapons) {
    if (!weapons || !weapons.length) return '';
    var h = '<section class="lx-appendix"><h2 class="lx-section-title">Weapons in this Army' +
            '<span class="lx-cat-pts">' + weapons.length +
            (weapons.length === 1 ? ' weapon' : ' weapons') + '</span></h2>' +
            '<div class="lx-stats-wrap"><table class="lx-weapons"><thead><tr>' +
            '<th>Weapon</th><th>Range</th><th>A</th><th>S</th><th>AP</th><th>D</th><th>Keywords</th>' +
            '</tr></thead><tbody>';
    weapons.forEach(function (w) {
      var label = esc(w.name) + (w.mods.length ? ' <span class="lx-item-mod">(' + esc(w.mods.join(', ')) + ')</span>' : '') +
        (w.duplicate ? ' <span class="lx-weapon-dup">&times;' + w.duplicate + ' merged</span>' : '');
      w.profiles.forEach(function (p, idx) {
        h += '<tr>';
        h += '<td class="lx-weapon-name">' + (idx === 0 ? label : '') +
             (p.profileName ? '<span class="lx-profile-name">' + esc(p.profileName) + '</span>' : '') + '</td>';
        ['range', 'attacks', 'strength', 'ap', 'damage'].forEach(function (f) {
          h += '<td>' + esc(p[f] == null || p[f] === '' ? '—' : String(p[f])) + '</td>';
        });
        h += '<td class="lx-weapon-kw">' + (p.keywords || []).map(function (k) {
          return '<span class="keyword" data-term="' + esc(slugOf(k)) + '" data-type="keyword">' + esc(k) + '</span>';
        }).join(', ') + '</td>';
        h += '</tr>';
      });
    });
    return h + '</tbody></table></div></section>';
  }

  function render(summary) {
    var over = summary.totalPoints > summary.targetPoints;
    var h = '';

    h += '<header class="lx-header">';
    if (summary.listName) h += '<h1 class="lx-title">' + esc(summary.listName) + '</h1>';
    h += '<div class="lx-subtitle">' + esc(summary.factionTitle) + '</div>';
    h += '<div class="lx-total' + (over ? ' lx-total--over' : '') + '">' +
         '<span class="lx-total-pts">' + fmt(summary.totalPoints) + '</span>' +
         '<span class="lx-total-sep"> / </span>' +
         '<span class="lx-total-target">' + fmt(summary.targetPoints) + '</span>' +
         '<span class="lx-total-label"> pts</span></div>';
    h += '</header>';

    if (summary.detachment.traits.length) {
      var dp = summary.detachment.budget != null
        ? '<span class="lx-dp">' + summary.detachment.spent + ' / ' + summary.detachment.budget + ' DP</span>' : '';
      h += '<section class="lx-detachment"><h2 class="lx-section-title">Detachment Traits' + dp + '</h2><ul class="lx-traits">';
      summary.detachment.traits.forEach(function (t) {
        // The sub-selection is part of the trait as taken — "Aspect Host" alone doesn't
        // tell the reader which unit became Battleline.
        h += '<li><div class="lx-trait-head">' + esc(t.name) +
             ((t.picks || []).length ? '<span class="lx-trait-pick"> — ' + esc(t.picks.join(', ')) + '</span>' : '') +
             (t.cost != null ? ' <span class="lx-trait-cost">' + t.cost + ' DP</span>' : '') + '</div>' +
             traitRulesHtml(t) + '</li>';
      });
      h += '</ul></section>';
    }

    summary.categories.forEach(function (cat) {
      h += '<section class="lx-cat">';
      h += '<h2 class="lx-section-title">' + esc(cat.name) +
           '<span class="lx-cat-pts">' + fmt(cat.points) + ' pts</span></h2>';
      cat.units.forEach(function (l) { h += unitHtml(l); });
      h += '</section>';
    });

    // Army-wide problems, plus units with choices still outstanding. Both must be
    // clear before the roster claims to be complete — a unit missing a compulsory
    // weapon is not a legal list even when every force-org limit is respected.
    var problems = summary.forceOrg.violations.concat(summary.detachment.violations);
    var incomplete = summary.units.filter(function (l) { return l.issues && l.issues.length; });
    if (problems.length || incomplete.length) {
      h += '<section class="lx-problems"><h2 class="lx-section-title">Outstanding</h2><ul>';
      problems.forEach(function (p) { h += '<li>&#9888; ' + esc(p) + '</li>'; });
      incomplete.forEach(function (l) {
        h += '<li>&#9888; ' + esc(l.unitName) + ': ' + esc(l.issues[0]) + '</li>';
      });
      h += '</ul></section>';
    } else if (summary.units.length) {
      h += '<div class="lx-valid">&#10003; Complete and within all force organisation limits</div>';
    }

    h += weaponAppendixHtml(summary.weapons);

    sheetEl.innerHTML = h;
    sheetEl.hidden = false;
    attachTooltips(sheetEl);
  }

  function attachTooltips(el) {
    if (window.__ahAttachTooltips) {
      var k = el.querySelectorAll('span.keyword[data-term]');
      if (k.length) window.__ahAttachTooltips(k);
    }
    if (!window.AH_REF) return;
    var fw = LB.data.factionWargear || {};
    if (LB.data.units && LB.data.units.weapons) {
      window.AH_REF.initWeaponRefs(el, LB.data.units.weapons, fw.wargearItems);
    }
    // Catalog items are held out of wargearItems so they can't be priced as ordinary
    // wargear, but they are still referenced here — so the tooltip lookup gets both.
    if (fw.wargearItems) {
      window.AH_REF.initWargearRefs(el, fw.wargearItems.concat(fw.catalogItems || []));
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function copyText(text, btn, okLabel) {
    var original = btn.textContent;
    function done(good) {
      btn.textContent = good ? okLabel : 'Copy failed';
      setTimeout(function () { btn.textContent = original; }, 1600);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }
  // execCommand path for non-secure contexts (plain http on a LAN address, say).
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var good = document.execCommand('copy');
      document.body.removeChild(ta);
      return good;
    } catch (e) { return false; }
  }

  // The short URL for this roster. Free if we arrived by one; otherwise minted on the
  // first Copy, so simply viewing a long link never writes anything server-side.
  var shortUrl = null;
  function shareUrl() {
    if (shortUrl) return Promise.resolve({ url: shortUrl, short: true });
    return AH_SHARE.shorten(LB.exportState()).then(function (path) {
      shortUrl = window.location.origin + path;
      return { url: shortUrl, short: true };
    }, function () {
      return { url: window.location.href, short: false };
    });
  }

  function wireActions() {
    actionsEl.hidden = false;
    $('lx-open-builder').href = '/list-builder#d=' + token;
    $('lx-copy-link').addEventListener('click', function () {
      var btn = this;
      shareUrl().then(function (res) {
        copyText(res.url, btn, res.short ? 'Link copied' : 'Full link copied');
      });
    });
    $('lx-copy-md').addEventListener('click', function () {
      copyText(LB.toMarkdown(), this, 'Markdown copied');
    });
    $('lx-print').addEventListener('click', function () { window.print(); });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  function boot() {
    statusEl = $('lx-status'); sheetEl = $('lx-sheet'); actionsEl = $('lx-actions');

    // A short link (/r/<id>) has to be resolved to its payload first; a full-length
    // link already carries one. Everything downstream is identical either way.
    var shortId = AH_SHARE.readShortId();
    var tokenReady;
    if (shortId) {
      shortUrl = window.location.origin + '/r/' + shortId;
      tokenReady = AH_SHARE.expand(shortId);
    } else {
      var inline = AH_SHARE.readToken();
      tokenReady = inline ? Promise.resolve(inline) : Promise.reject(new Error('no list'));
    }

    tokenReady.then(function (t) {
      token = t;
      var slug = AH_SHARE.factionOf(token);
      if (!slug) throw new Error('This link is damaged and could not be read.');

      // The faction slug is in cleartext, so its data can load in parallel with decoding.
      return Promise.all([LB.loadFaction(slug), AH_SHARE.decode(token)]);
    })
      .then(function (res) {
        var state = res[1];
        if (!LB.data.units) throw new Error('This list is for a faction that is no longer published.');
        var report = LB.hydrate(state);
        if (!report.units) throw new Error('This list has no units in it.');

        render(LB.listSummary());
        wireActions();

        if (report.notes.length) {
          setStatus('<strong>This list was built against older rules data.</strong><ul><li>' +
                    report.notes.map(esc).join('</li><li>') + '</li></ul>' +
                    'The roster below reflects the current rules.', 'warn');
        } else {
          statusEl.hidden = true;
        }
        document.title = (LB.state.listName || 'Army List') + ' — Countermarch';
      })
      .catch(function (err) {
        if (err && err.message === 'no list') {
          setStatus('No army list in this link. <a href="/list-builder">Open the list builder</a> to create one.', 'empty');
          return;
        }
        var msg = esc((err && err.message) || 'This link could not be read.');
        // An expired link was real once, so say what happened and what fixes it: the
        // player who made it gets the same short link back by sharing the list again.
        if (err && err.expired) {
          msg += '<br>Shared lists are kept for 90 days. Ask whoever sent it to share ' +
                 'the list again — they will get the same link back.';
        }
        setStatus(msg + '<br><a href="/list-builder">Open the list builder</a>', 'error');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
