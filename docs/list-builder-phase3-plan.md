# List Builder — Phase 3: Shareable Lists & Export

**Status:** implemented — 2026-08-07
**Supersedes:** §5 "Phase 3" and the `src/pages/list-export/[listId].astro` row of §6.2 in
*AltHammer-ListBuilder-DevPlan v1.2*

## Outcome

All four Phase 3 items are built, plus the print stylesheet folded in from Phase 4.
The size gate that governed the architecture was measured, not guessed:

| Battle size | Worst faction measured | Share URL |
| --- | --- | --- |
| Patrol (500) | Adeptus Astartes | 465 chars |
| Combat (1,000) | Adeptus Astartes | 609 chars |
| Strike Force (1,500) | Astra Militarum | 883 chars |
| Onslaught (2,000) | Astra Militarum | **1,076 chars** |
| *pathological* (every option on every unit, 2,000 pts) | Adeptus Astartes | 1,528 chars |

Comfortably inside the ~2,000-character "still looks like a link" threshold and far
below the ~32,000 browser limit, so **no server storage is needed** and the Phase 4
Netlify Blobs fallback stays unnecessary. Q7's size concern is resolved.

### Files

| File | Change |
| --- | --- |
| `public/js/list-builder.js` | `_walkUnit` traversal; `unitLoadout`, `listSummary`, `toMarkdown`, `categoryOrder`, `exportState`, `hydrate`, `clampAll`, `setListName`; `_reclamp` extraction; `listName` in state |
| `public/js/list-share.js` | new — URL codec (deflate-raw + base64url, `v1.<faction>.<payload>`) |
| `public/js/list-library.js` | new — localStorage saved-list library |
| `public/js/list-export.js` | new — read-only roster renderer |
| `public/js/list-builder-ui.js` | name field, Share / Roster / Copy / Lists / New, share-link hydration; `sortedCats` delegates to the engine |
| `src/pages/list-export.astro` | new — export page shell |
| `public/styles/list-export.css` | new — roster styles + print stylesheet |
| `public/styles/list-builder.css` | Phase 3 controls and library drawer |
| `_lb-harness.cjs`, `_lb-baseline.cjs` | new — shared headless harness and points-baseline snapshotter |
| `_t-phase3-loadout.cjs`, `_t-phase3-share.cjs`, `_t-phase3-e2e.cjs` | new — reconciliation, codec, and browser end-to-end suites |

### Phase 3b — roster depth (added after first review)

The export view carries the unit profile, not just the shopping list:

- **Statlines** per model type present, from `resolvedStats` — so armour swaps, gifts and
  detachment traits are reflected, and a cell that moved off the book value is marked
  (underlined in print, where colour cannot carry it). Row labels appear only on units
  fielding more than one kind of model.
- **Keywords** per unit from `resolvedKeywords`, unioned across the model types present,
  so granted abilities (Feel No Pain, Invulnerable Save) show alongside the printed ones.
- **Rules prose** on an allow-list — `specialAbilities`, `leader`, `additionalRules`, and
  `keyCharacteristic` resolved to *what was selected* (an inline profile's abilities and
  leader text, or the chosen catalog items' effects). Excluded as redundant with the
  selections already listed: composition, standard wargear, wargear options, armour
  options, force organisation. Section prose is stored as HTML carrying the site's own
  reference spans, so injecting it gives the roster the faction pages' tooltips.
- **Weapon appendix** — one deduplicated table per army, modifier-aware (a Twin-linked
  Boltgun is its own entry) and multi-profile aware. Tooltips carry weapon stats on
  screen but cannot on paper; this is what covers the printed roster.
- **Nested carried items** — a combi-weapon's chosen sub-weapon and a mount's included
  weapon now sit under the item that brings them, in the roster and in Markdown.

Markdown deliberately stayed lean (name, models, points, wargear) so it remains
paste-able into chat; only the nesting indentation was added.

### Phase 4 — short share links

`https://alt-hammer.netlify.app/r/K3n8Qw2Lx7` — **43 characters**, against 246–1,076 for
the full-length equivalent.

**The id is a content hash**: the first 10 base64url characters of SHA-256 over the same
compressed payload a long link carries. That buys idempotency for free — re-sharing an
unchanged list returns the link it already had rather than minting a second record, and
an edited list gets a new one. A prefix collision is detectable (compare the stored
bytes) and answered by lengthening the id.

| File | Role |
| --- | --- |
| `src/pages/api/list/_store.ts` | Blobs access, id derivation, TTL. The `_` prefix keeps Astro from routing it |
| `src/pages/api/list/index.ts` | `POST {token}` → `{id}`; `GET ?id=` → `{token}`, 404 unknown, **410 expired** |
| `src/pages/r/[id].astro` | The short-link roster route (SSR, `cache-control: max-age=3600`) |
| `src/components/RosterSheet.astro` | The roster shell, shared by `/list-export` and `/r/<id>` so the two cannot drift |
| `public/js/list-share.js` | `shorten`, `expand`, `readShortId`, `buildShareUrl` (falls back to the long form) |
| `public/js/list-export.js` | Resolves `/r/<id>` before rendering; explains an expired link |
| `public/js/list-builder-ui.js` | Share opens a tab **and** copies; Roster opens a tab |
| `_lb-serve.cjs` | Static server + an in-memory stand-in for the API, so the browser suites need nothing running first |

**Two things the plan got wrong, found by running the real stack** (`netlify dev`, which
is why the CLI is now a devDependency — SSR routes cannot be exercised without it):

- *The id could not live in the path.* Netlify resolves extensionless paths against the
  static site before invoking the function and appends `.html` when nothing matches, so
  `/api/list/<id>` arrived at the endpoint as `/api/list/<id>.html` and never validated.
  The id moved to a query parameter, which is not subject to that rewriting. This would
  have failed in production exactly as it failed locally — and it was initially masked by
  the endpoint's own `cache-control`, which served a stale 200 for the one id that had
  been fetched before the bug existed.
- *The `/r/* → /list-export` rewrite never fired.* Redirects and static resolution are
  evaluated ahead of framework routing, so the request 404'd before reaching the page.
  `/r/<id>` is now a real Astro route, which behaves the same in dev and production and
  leaves nothing to keep in step.

**The codec is untouched**, so every long `#d=` link already in circulation keeps working;
shortening is a lookup in front of the same payload.

**Pop-up safety:** both buttons open the tab synchronously on the click and point it at
the URL once known. Opening it after the `await` would be treated as an unsolicited
pop-up and blocked.

**Expiry:** 90 days from creation, enforced at read time. Re-sharing before then restarts
the clock, and because ids are content hashes, re-sharing an expired list regenerates the
*same* URL — so an expired link is revivable by whoever made it.

**404 handling changed site-wide:** the `netlify.toml` catch-all `/* → /404` is gone.
Netlify evaluates redirect rules before function routing, so it would have swallowed
`/api/list` before the SSR function ever ran. The Astro adapter registers its function at
`/*` with `preferStatic`, so unmatched paths now reach Astro and render its own 404 page —
verified under `netlify dev`, where `/no-such-page` still answers 404.

### Verification

- **787 unit configurations** across all 16 factions: the loadout summariser reconciles
  to `calcUnitPoints` exactly, every priced record surfaces as a roster line, and no
  zero/negative/empty lines leak to display.
- **Points neutrality** of the `_walkUnit` refactor proved by before/after baseline
  diff over the same 787 configurations — zero differences (bar one dead legacy file,
  see below).
- **Codec**: round-trip fidelity across four factions, malformed input rejected, and
  stale links degrading with reported losses rather than silent mispricing.
- **Browser end-to-end** (Playwright/Chromium, 29 assertions): build → share → open →
  roster matches → Markdown → print → save → reload → damaged link, with no page errors.

---

## 1. How the codebase has moved since the dev plan

The v1.2 document was written before Phases 1–2 landed. Four things it assumes are no
longer true, and they change Phase 3's shape:

| v1.2 assumption | Reality today | Consequence for Phase 3 |
| --- | --- | --- |
| `listState.units[]` entries are `{unitName, modelCount, isWarlord, armourType, selectedWargear, computedPoints}` (§6.3) | Entries carry `modelCounts, tier, sel, keyChar, gifts, relic, nested, instanceCount, subRelic, isWarlord, squadronHost` | The share codec must round-trip ~11 sub-structures, not 3 |
| Persistence is `localStorage` (§5 Phase 1C) | Persistence is `sessionStorage`, deliberately — one list per browser tab (Q6) | The saved-list library layers *on top of* the per-tab draft; it does not replace it |
| An export renders "wargear per unit" from list data | Nothing in the engine enumerates a unit's equipment. `calcUnitPoints` walks every selection to produce a **number**; the UI renders selections as interactive controls embedded in clause prose | A loadout summariser must be built first — it is the critical path, not the URL codec |
| A "static shareable page" avoids URL-encoding (Q7) | Without server storage a shareable page can only get its list from the URL | The two Q7 options are not alternatives: URL-encoding is the *transport*, the export view is the *render target*. Both get built, together |

One more, from Q7's size worry: **page weight and URL length are separate concerns.** The
export page loads the same faction JSON the builder already loads, so its weight is fixed
and independent of list size. Only the URL grows with the list. The size risk is therefore
link length, and it is measurable — see the gate in §4.

---

## 2. Confirmed decisions

| Decision | Choice |
| --- | --- |
| Export view depth | Roster + wargear. Faction/points header, units by category, model counts, per-model loadouts, per-unit and total points, force-org summary, detachment traits by name + DP. No statlines or weapon profiles. |
| Share transport | URL-encoded, compressed via the browser's native `CompressionStream`. No server, no storage. |
| Saved lists | `sessionStorage` stays the live per-tab draft; `localStorage` becomes a named library with explicit Save / Save As / Load / Rename / Delete. Loading replaces that tab's draft only. |
| Clipboard format | Markdown. |

---

## 3. Workstreams

### A. Loadout summariser — engine *(critical path; blocks C and D)*

New in `public/js/list-builder.js`, exposed as `LB.unitLoadout(entry)` and
`LB.listSummary()`. Returns plain data, no HTML:

```js
{
  unitName, modelCounts, totalModels, isWarlord, points,
  groups: [ { label, items: [ { name, qty, modifiers: [], kind, points, note } ] } ]
}
```

It must account for every contributor `calcUnitPoints` already walks, or the export will
silently disagree with the builder's totals:

- base model types from `composition`
- `fixed` clauses (standard wargear), honouring `_fixedN` model/role scoping
- `choose` / `add` / `replace` selections in `entry.sel`, honouring the
  `scope.who === 'unit'` multiplier
- sub-selections in `entry.nested` (combi / turret / warsuit / sponson) and
  `entry.instanceCount`
- auto-included weapons (`itemIncludedWeapons`)
- relic modifiers (`entry.relic`) and sub-relics (`entry.subRelic`)
- upgrade-catalog gifts (`entry.gifts`), per-model, tier-priced
- key-characteristic profiles (`entry.keyChar`)
- **exclusions:** suppressed clauses (`isSuppressibleClause`) and weapons displaced by
  `replacedStandardWeapons` must not appear

Item labels come from the structured `o.parts` array (`{ref, name, kind, qty, modifiers}`)
that the UI's `refSpan`/`optLabel` already consume — so plain-text and Markdown labels are
derivable without touching the HTML renderers.

Also lift category ordering (`sortedCats`, currently private to
`public/js/list-builder-ui.js`) into the engine as `LB.categoryOrder`, since the builder,
the export view and the Markdown writer all need the same grouping.

**Verification:** a reconciliation invariant — for every unit in a populated list, the sum
of `groups[].items[].points` plus base model cost must equal `calcUnitPoints(entry)`.
Exercised by a Node harness in the repo's existing `_t*.cjs` style, run across all 16
faction JSONs with representative loadouts. This is what stops the export from quietly
drifting from the builder.

### B. Share codec + share links

New `public/js/list-share.js`:

- `encodeState(state)` — drop volatile fields (`computedPoints`, `selectedUnitId`,
  entry `id`s are re-derived on decode), shorten stable keys, `JSON` → `deflate-raw` via
  `CompressionStream` → base64url.
- `decodeState(str)` — inverse, with a `v1.` version prefix and the faction slug in
  cleartext so the export page can start its faction fetch before decompressing.
- **Stale-link resilience:** after hydrating, run the engine's existing clamp pass
  (`_clampModelCounts`, `_clampAvailability`, `_clampUnitCap`, `_clampKeyChar`,
  `_clampGifts`, `_clampRelic`) via a new `LB.clampAll()` entry point, collect anything
  dropped, and surface *"built against an older data version — N selections could not be
  restored"*. Links degrade rather than fail, which matters because the pipeline
  regenerates unit JSON regularly.
- Share button in the builder header: build URL, copy to clipboard.
- The builder also accepts `#d=` on load, so a share link can be opened *and edited*, not
  just viewed.

### C. Export view

New `src/pages/list-export.astro` (prerendered static shell, all data client-side — the
same architecture as `list-builder.astro`, per §6.4), plus `public/js/list-export.js` and
`public/styles/list-export.css`.

- Reads `#d=`, decodes, loads faction data through the existing `LB.loadFaction`, renders
  read-only from `LB.listSummary()`.
- Header: list name, faction, total / target points, detachment traits with DP spend.
- Units grouped by category, per-model loadouts, per-unit points, Warlord marked.
- Force-organisation summary from the existing `validateForceOrg()`.
- Actions: Open in builder · Copy link · Copy as Markdown · Print.
- Reuses `ref-tooltips.js` / `keyword-tooltips.js`, so weapon and keyword lookups work in
  the export exactly as they do on the faction pages.

### D. Markdown clipboard export

`LB.toMarkdown()` built on the summariser: `#` list name, faction and points line, `##`
per category, bold unit names with points, bullet-listed wargear. Copy buttons in both the
builder and the export view, via `navigator.clipboard.writeText` with a textarea fallback
for non-secure contexts.

### E. List naming and the saved library

- Add `listName` to `_defaultState()` — backwards compatible through the existing
  `Object.assign` restore, so no `SESSION_KEY` bump.
- `localStorage` key `ah-lb-library`: `[{id, name, faction, points, savedAt, blob}]`, where
  `blob` reuses the §B codec so stored lists stay small against the ~5 MB quota.
- UI: editable list-name field in the Army List panel header, plus a Lists menu — Save,
  Save As, Load, Rename, Delete, New.
- Quota guard with a clear warning if a save would exceed available space.

### F. Print stylesheet *(recommended fold-in)*

`@media print` rules for the export view — drop nav, chrome and action buttons, keep units
from breaking across pages. v1.2 lists this as optional Phase 4, but the export view is its
natural target and the cost here is small.

---

## 4. Sequencing

```
A (summariser) ──┬──> C (export view) ──> F (print)
                 └──> D (markdown)
B (codec) ───────────> C
E (library) ── independent
```

1. **A** — summariser + reconciliation harness
2. **B** — codec, then **measure a real 2,000 pt list and report the URL length before
   continuing** ← *gate*
3. **C** — export view
4. **D** — Markdown output
5. **E** — naming + library
6. **F** — print stylesheet

---

## 5. Assumptions and risks

**Assumptions** (flag any you'd rather change):

- Export view is prerendered + client-hydrated. No SSR route, no Netlify Function, no
  stored data — consistent with §6.4 and the current build.
- Share links open in the export view by default; the builder accepts the same link for
  editing.
- Stale links degrade with a warning rather than failing hard.

**Risks:**

| Risk | Mitigation |
| --- | --- |
| URL length on large lists | Measured at the step-2 gate. If a 2,000 pt list exceeds ~4 KB I'll report before building further, so the Phase 4 Netlify Blobs short-link fallback stays a live option. |
| Summariser drifting from `calcUnitPoints` | The reconciliation invariant in §A, run across all factions. |
| Codec breaking on regenerated unit data | Version prefix + clamp-and-warn on decode. |
| Browser-verifying against a stale build | `npm run dev` serves the prebuilt `dist/` — rebuild before any browser check. |

---

## 6. Out of scope

Server-side list storage, short-ID share links, points analytics, and quick-add from
faction reference pages all remain Phase 4. The size measurement above means the first
two are no longer needed on size grounds.

---

## 7. Found along the way — for your decision

Three pre-existing issues surfaced while working in this code. The first two are fixed
(both verified behaviour-neutral); the third is data and is left alone.

1. **`_clampModelCounts` was declared twice** in `list-builder.js`. The second
   declaration shadowed the first, so the `isTransform` guard the newer comment
   describes never ran. The stale copy is removed and the transform-aware version
   restored — verified as zero change across all 787 configurations, since no transform
   unit currently hits a ratio-limited clamp. It would have started mattering silently
   the moment one did.

2. **The builder called a list "Army valid" while units still had compulsory choices
   outstanding.** Once the export view existed, the two views disagreed about the same
   list. Both now treat unresolved unit choices as blocking, and the builder shows
   "N units have choices still to make".

3. **`src/data/units/tau-empire.json` is a stale legacy artefact** — superseded by
   `the-tau-empire.json`, not an active faction slug, and its first "unit" is the Excel
   header row parsed as data (`basePoints` is the string `"Base Points per Model"`).
   It priced as `NaN` before this work and as `0` now, because the new sum guards a
   non-numeric record. Nothing reaches it from the app. Deleting it (and checking
   `chaos-daemons.json` / `agents-of-the-imperium.json`, which look similar) is a data
   call rather than a code one, so it is left for you.

Also noted, not changed: `LB.loadFaction` requests
`/data/upgrade-catalogs/{slug}.json` for every faction, but only Asuryani and Chaos
Undivided publish one. The miss is caught and treated as "no catalog", so behaviour is
correct — it just logs a 404 in the console for the other fourteen factions.
