/**
 * keyword-tooltips.js
 * ───────────────────
 * Hover tooltip system for Alt-Hammer 40,000.
 *
 * How it works:
 *   1. Reads window.AH_DEFINITIONS, which is embedded as an inline <script>
 *      in BaseLayout.astro from src/data/definitions.json.
 *   2. On page load, finds all <span class="keyword" data-term="..."> elements.
 *   3. On hover, looks up the data-term slug in AH_DEFINITIONS and displays
 *      a floating tooltip containing the full rule text.
 *
 * Slug lookup strategy:
 *   - Tries an exact match first: "feel-no-pain-5" → not found
 *   - Strips the last hyphen-segment and retries: "feel-no-pain" → found ✓
 *   - Continues stripping until a match is found or no segments remain.
 *   This handles all parameterized keywords (Feel No Pain 5+, Scout 6",
 *   Rapid Fire 2, Anti-Infantry 4+, etc.) automatically.
 *
 * If no definition is found, the span still renders with gold styling
 * (from global.css .keyword) but shows no tooltip — silent graceful degradation.
 */

(function () {
  'use strict';

  // ── Look up a definition by slug, with prefix-fallback ──────────────────────

  function lookupDefinition(slug) {
    const defs = window.AH_DEFINITIONS;
    if (!defs) return null;

    // Exact match
    if (defs[slug]) return defs[slug];

    // Strip last hyphen-segment and retry (handles "feel-no-pain-5" → "feel-no-pain")
    let s = slug;
    while (s.includes('-')) {
      s = s.substring(0, s.lastIndexOf('-'));
      if (defs[s]) return defs[s];
    }

    return null;
  }


  // ── Build tooltip DOM element ────────────────────────────────────────────────

  let tooltip = null;

  function buildTooltip() {
    tooltip = document.createElement('div');
    tooltip.setAttribute('id', 'ah-tooltip');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-live', 'polite');

    // Base styles — detailed visual polish matches the site's design system
    Object.assign(tooltip.style, {
      position:       'fixed',
      zIndex:         '9999',
      maxWidth:       '320px',
      minWidth:       '180px',
      padding:        '0',
      background:     'var(--color-surface-2, #161d26)',
      border:         '1px solid var(--color-gold-dim, #6b5420)',
      borderRadius:   '3px',
      boxShadow:      '0 6px 28px rgba(0,0,0,0.65)',
      color:          'var(--color-text, #c8b88a)',
      fontSize:       '0.8rem',
      lineHeight:     '1.5',
      pointerEvents:  'none',
      opacity:        '0',
      transition:     'opacity 0.1s ease',
      userSelect:     'none',
    });

    document.body.appendChild(tooltip);
  }


  // ── Render tooltip content ───────────────────────────────────────────────────

  function renderTooltip(def) {
    const typeLabel = def.type === 'action' ? 'ACTION' : 'KEYWORD';

    // Convert plain-text body (with • bullet lines) into HTML paragraphs
    const bodyHtml = formatBody(def.body);

    tooltip.innerHTML = `
      <div style="
        padding: 6px 12px 5px;
        background: var(--color-surface-3, #1e2830);
        border-bottom: 1px solid var(--color-gold-dim, #6b5420);
        display: flex;
        align-items: baseline;
        gap: 8px;
      ">
        <span style="
          font-family: var(--font-display, 'Cinzel', serif);
          font-size: 0.68rem;
          letter-spacing: 0.12em;
          color: var(--color-gold-dim, #9a7530);
          text-transform: uppercase;
        ">${typeLabel}</span>
        <span style="
          font-family: var(--font-display, 'Cinzel', serif);
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--color-gold-bright, #e8c96a);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        ">${escapeHtml(def.name)}</span>
      </div>
      <div style="padding: 9px 12px 10px; color: var(--color-text-muted, #a89060);">
        ${bodyHtml}
      </div>
    `;
  }

  /**
   * Convert plain-text body (with • bullet lines and paragraph breaks)
   * into HTML. Lines starting with • become a <ul> list.
   */
  function formatBody(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const parts = [];
    let listItems = [];

    function flushList() {
      if (listItems.length > 0) {
        parts.push(
          '<ul style="margin: 4px 0 4px 12px; padding: 0; list-style: none;">' +
          listItems.map(li =>
            `<li style="margin-bottom:3px; padding-left:10px; position:relative;">` +
            `<span style="position:absolute;left:0;color:var(--color-gold-dim,#9a7530);">•</span>` +
            escapeHtml(li) + `</li>`
          ).join('') +
          '</ul>'
        );
        listItems = [];
      }
    }

    for (const line of lines) {
      if (line.startsWith('• ')) {
        listItems.push(line.slice(2));
      } else {
        flushList();
        if (line.trim()) {
          parts.push(`<p style="margin: 0 0 5px;">${escapeHtml(line)}</p>`);
        }
      }
    }
    flushList();

    return parts.join('');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }


  // ── Position tooltip near the cursor ────────────────────────────────────────

  function positionTooltip(clientX, clientY) {
    if (!tooltip) return;

    const pad       = 14;
    const vpW       = window.innerWidth;
    const vpH       = window.innerHeight;
    const tipW      = tooltip.offsetWidth  || 300;
    const tipH      = tooltip.offsetHeight || 120;

    // Prefer: above and to the right of cursor
    let x = clientX + pad;
    let y = clientY - tipH - pad;

    // Flip left if would overflow right edge
    if (x + tipW > vpW - 8) x = clientX - tipW - pad;
    // Flip below if would overflow top edge
    if (y < 8) y = clientY + pad;
    // Clamp within viewport
    x = Math.max(8, Math.min(x, vpW - tipW - 8));
    y = Math.max(8, Math.min(y, vpH - tipH - 8));

    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }


  // ── Wire up all keyword spans ────────────────────────────────────────────────

  function attachTooltips() {
    const spans = document.querySelectorAll('span.keyword[data-term]');

    spans.forEach(function (el) {
      const def = lookupDefinition(el.dataset.term);
      if (!def) return; // no definition — span still styled gold, just no tooltip

      let visible = false;

      el.addEventListener('mouseenter', function (e) {
        renderTooltip(def);
        positionTooltip(e.clientX, e.clientY);
        tooltip.style.opacity = '1';
        visible = true;
      });

      el.addEventListener('mousemove', function (e) {
        if (visible) positionTooltip(e.clientX, e.clientY);
      });

      el.addEventListener('mouseleave', function () {
        tooltip.style.opacity = '0';
        visible = false;
      });
    });
  }


  // ── Initialise ───────────────────────────────────────────────────────────────

  function init() {
    if (!window.AH_DEFINITIONS) {
      // Definitions not embedded — tooltip system inactive, spans still styled
      return;
    }
    buildTooltip();
    attachTooltips();
    // Expose for dynamic re-attachment (unit profile cards injected after load)
    window.__ahAttachTooltips = attachTooltips;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }


// ── Section button active state on scroll ────────────────────────────────
  function initSectionButtons() {
    const buttons = document.querySelectorAll('.faction-section-btn');
    if (!buttons.length) return;

    const sections = Array.from(buttons).map((btn) => {
      const href = btn.getAttribute('href');
      const id = href ? href.replace('#', '') : '';
      return { btn, el: document.getElementById(id) };
    }).filter((s) => s.el);

    function onScroll() {
      const scrollY = window.scrollY + 140; // offset for sticky header height
      let current = sections[0];
      for (const s of sections) {
        if (s.el.getBoundingClientRect().top + window.scrollY <= scrollY) {
          current = s;
        }
      }
      buttons.forEach((b) => b.classList.remove('active'));
      if (current) current.btn.classList.add('active');
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  initSectionButtons();


})();
