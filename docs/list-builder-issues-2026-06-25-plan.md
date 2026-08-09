# List Builder — Issues Log 2026-06-25: Implementation Plan

*Prepared for review/approval. Source: `Alt-Hammer List Builder - Issues Log 2026-06-25` (QA on Adeptus Astartes).*
*Companion to `docs/list-builder-redesign-plan.md` and `docs/wargear-grammar.md`.*

Each issue is diagnosed against the current code and sorted into **Part A — Immediate** (finish the current increment: correctness + UX + display completeness) or **Part B — Rules-Depth increment** (deeper rules-effect integration, consistent with the staged approach we agreed). Effort is rough: **S** ≈ a few edits, **M** ≈ a focused feature, **L** ≈ a substantial change.

> **Prerequisite (carry-over from last session):** the source doc currently has a stray `"the unit"` at Faction Index line 822 (Intercessors) and references `Onslaught Cannon` / `Punisher Cannon` weapons not yet in the Weapon Data Tables Excel. `convert_options` hard-errors on these. They must be fixed so the AA data rebuilds clean before/with this work — and Issue A1 (Gladiator) depends on `Twin-linked Onslaught Cannon` resolving to a cost.

---

## Summary

| ID | Issue | Area | Category | Effort |
|----|-------|------|----------|--------|
| A1 | Replaced standard-wargear cost not subtracted | Points | Immediate | M |
| A2 | `Nx` inline quantity not multiplied into points | Points | Immediate | S |
| A3 | Conditional (`requires`) option limits not enforced | Validity | Immediate | L |
| A4 | "Each [weapon]… upgrade" not scaled to # equipped | Validity | Immediate | M |
| A5 | Selection rebuilds panel → scroll jump + pinned tooltips | UX | Immediate | L |
| A6 | Model-count section needs padding | UX | Immediate | S |
| A7 | Special Abilities bold/lists render as literal markdown | Display | Immediate | S |
| A8 | Wargear tooltip missing rules text | Display | Immediate | S |
| A9 | Detachment traits inline, not one-per-line | Detachment UI | Immediate | S |
| A10 | Detachment traits not grouped by subsection | Detachment UI | Immediate | S |
| A11 | Detachment trait rules not viewable (accordions) | Detachment UI | Immediate | M |
| A12 | Multi-statline units show no model stepper | Composition | Immediate | M |
| B1 | Detachment trait exclusivity / category caps | Rules depth | Subsequent | M |
| B2 | Detachment traits modify unit statlines | Rules depth | Subsequent | L |
| B3 | Wargear modifies model statlines in real time | Rules depth | Subsequent | L |
| B4 | Veterans variant-locked composition (Sternguard ⊻ Vanguard) | Composition | Subsequent | M–L |

---

## Part A — Immediate (finish current increment)

### A1 · Subtract replaced standard-wargear cost  *(Points · M)*
**Issue.** Gladiator (90) includes Twin-linked Onslaught Cannon (45); replacing it with a Laser Destroyer (100) yields 90+45+100 instead of 90+45+100−45.
**Diagnosis.** A `replace` clause that targets a *named weapon* (`replaces:{weapon:…}`) is not slot-pooled, so nothing removes the fixed weapon's cost. (Slot-targeted replaces — e.g. "replace its Primary Ranged weapon" — are already correct via the slot pool, which is why this only bites weapon-named replaces.)
**Fix.** In the engine points calc, for each `replace` clause with `replaces.weapon` (or `replaces.weapons[]`), subtract the resolved cost of the replaced weapon × number of replacements made (× model count for `who:unit`). Add a weapon/wargear cost lookup against the loaded faction data (Twin-linked names resolved via the same formula the parser uses).
**Note / source consistency.** Gladiator's Standard Wargear name (`Onslaught Cannon`) and the replace target (`Twin-linked Onslaught Cannon`) currently differ; they should name the same item so the subtraction resolves cleanly. (Ties to the prerequisite above.)

### A2 · Apply `Nx` quantity to option points  *(Points · S)*
**Issue.** "2x Storm Bolter +8" should be +16; "2x Multi-melta +25" should be +50, etc.
**Diagnosis.** The parser stores `qty` on the option but `points` holds the single-item cost. The `fixed` path multiplies by `qty`, but the `choose/add/replace` path does not (`total += points × count`, ignoring `qty`), and the option label prints base `points`.
**Fix.** Bake `qty` into the option's resolved `points` at parse time (`convert_options.resolve_option`), keeping the `qty` field only for the display prefix ("2×"). Then remove the now-redundant `× qty` in the engine's `fixed` path so multiplication happens in exactly one place. Display and calc both become correct everywhere.

### A3 · Enforce conditional (`requires`) option limits  *(Validity · L)*
**Issue.** Intercessors: "If an Intercessor's only Ranged weapon(s) have the Pistol keyword, it can be equipped with a Chainsword." With 2 Pistol-keyword models the user could still add 3 Chainswords.
**Diagnosis.** Clauses carry `scope.requires` (`{weaponKeyword}`, `{weaponIn}`, `{armour}`) but the UI/engine ignore it — the control is shown ungated and uncapped.
**Fix.** Add a predicate evaluator that, from the unit's current selections, computes the **number of qualifying models**, then caps the clause at that number (and hides/disables it when zero):
- `weaponKeyword: Pistol` → count models whose primary-ranged pick has the Pistol keyword (sum the slot-pool counts of options whose weapon has that keyword).
- `weaponIn: [Boltgun, Bolt Rifle]` → count models with one of those in the relevant slot.
- `armour: Phobos` → enabled only while the unit's armour selection is Phobos (then per the clause's own scope).

Requires a weapon-keyword lookup (already in the weapons JSON). **This is the largest immediate item;** it also lays the groundwork for armour→weapon-availability filtering (related, can follow in the same pass or be deferred — flag for decision).

### A4 · Scale "Each [weapon] can be upgraded…" to the number equipped  *(Validity · M)*
**Issue.** Contemptor/Redemptor: "Each Dreadnought Power Fist equipped by this model can be upgraded to include 1 of the following." If 2 Power Fists are equipped, the upgrade should allow up to 2 picks (radio→stepper); currently fixed.
**Diagnosis.** `op:'modifier'` with `appliesTo:{weapon}` currently caps at model count, not at the count of that weapon actually selected elsewhere in the unit.
**Fix.** Compute the equipped count of `appliesTo.weapon` across the unit's selections (shares the counting helper from A3), set that as the clause cap, and render a stepper when the cap > 1 (radio when 1, hidden when 0).

### A5 · Stop full-panel rebuild on each selection  *(UX · L)*
**Issue.** (a) Selecting any option scrolls the panel back to the top; (b) a tooltip shown on hover stays pinned permanently after a click.
**Diagnosis.** Both stem from `renderAll()` replacing `lb-options-body.innerHTML` on every change: scroll position and open `<details>` reset, and the hovered ref-span is destroyed without firing `mouseleave`, orphaning its tooltip node on `document.body`.
**Fix.** On in-unit selection changes, stop rebuilding the whole panel. Preferred: targeted updates (option counts, points, disabled states) without re-templating. Acceptable interim: before re-render, (1) remove any stray `.ah-ref-tooltip` nodes from `document.body`, (2) capture `scrollTop` + open-accordion keys, (3) restore them after. Also harden the tooltip lifecycle so a tooltip is removed on the element's removal and (mobile) dismissed on tap-away. Fixes Issues 12 + 13 together.

### A6 · Pad the model-count section  *(UX · S)*
**Fix.** Add horizontal padding to the composition/stepper block so the −/＋ buttons aren't flush against the section edges (CSS only).

### A7 · Render Special Abilities bold/italic/lists  *(Display · S)*
**Issue.** "**Deeds of Legend:**" shows literal asterisks in the builder (renders bold on the faction page).
**Diagnosis.** `convert_options._render_prose_only()` wraps `runs_to_markdown()` output in `<p>` but never converts markdown `**bold**` / `*italic*` / `- list` to HTML; the builder injects it as raw HTML.
**Fix.** Convert inline markdown (`**`→`<strong>`, `*`→`<em>`) and list lines (`- `/`* `→`<ul><li>`) in `_render_prose_only` (mirror the logic already in the retired `extract_unit_profiles._md_to_html`). Prose-only sections then match the faction pages.

### A8 · Show wargear rules in the wargear tooltip  *(Display · S)*
**Issue.** Wargear tooltip shows only name + points, not the rules text.
**Diagnosis.** `ref-tooltips.initWargearRefs()` calls `buildWargearTooltip(name, pts, '')` with an empty body, even though `buildWargearTooltip` supports a body and `faction-wargear/*.json` carries an `effects[]` array per item.
**Fix.** Build the tooltip body from `entry.effects` (bulleted). *(Applying stat modifications to the live statline is separate — see B3.)*

### A9–A11 · Detachment Traits panel  *(Detachment UI · S/S/M)*
**Issues.** Traits render inline (should be one per line); not grouped by subsection; rules text not viewable.
**Diagnosis.** The current panel is a minimal stopgap. The data already supports the fixes: each trait has `category` ("Chapter Identity…" / "Chapter Company…") and an `effects[]` array; the file also has `introText`.
**Fix.** Rebuild the panel: group traits under their `category` subheaders (A10), one trait per row with its checkbox (A9), each row with an expandable accordion (`<details>`) showing `effects` (A11) — reusing the site's accordion styling. *(Selection limits are B1.)*

### A12 · Render model steppers for multi-statline units  *(Composition · M)*
**Issue.** Veterans has no model-count stepper.
**Diagnosis.** Veterans is `composition.mode:'multi'` (model types "Sternguard Veteran", "Vanguard Veteran"). `renderFixedZone` only draws a stepper for `mode:'range'`, so multi-statline units get none.
**Fix.** Render a per-model-type stepper (with that type's min/max from its `squadSizes`) for `mode:'multi'`, each showing its own statline (already rendered) and points/model. This restores basic model selection for *all* multi-statline units. **Veterans' variant-lock** (you may only field Sternguard **or** Vanguard, plus the sergeant variant) is **not** solved here — see B4.

---

## Part B — Subsequent "Rules Depth" increment

### B1 · Detachment trait exclusivity & category caps  *(M)*
Max 1 from "Chapter Identity", max 1 from "Chapter Company", and trait-excludes-trait rules. Needs structured exclusivity data on each trait (new fields from `convert_detachment_traits`) plus selection-time enforcement in the panel. *(You flagged this as a future rules-depth item.)*

### B2 · Detachment traits modify unit statlines  *(L)*
E.g. "Adeptus Astartes Mounted units gain Relentless and Unyielding." Requires a structured effects model (target keyword filter + stat/keyword deltas) and a statline-resolution layer that recomputes affected units' displayed profiles in real time. Significant new subsystem; pairs naturally with B3.

### B3 · Wargear modifies model statlines in real time  *(L)*
E.g. armour types changing M/T/W/SV and granting keywords. The faction-wargear `effects[]` are currently prose; this needs them as structured deltas, plus the same statline-resolution layer as B2 (and interaction with availability filtering). You noted this may be deferred or deemed infeasible — recommend bundling with B2 as one "live statline" feature.

### B4 · Veterans variant-locked composition  *(M–L)*
Choose a Sternguard **or** Vanguard sergeant (1, compulsory), then 2–4 of the *matching* Veteran type only. The sergeant variants aren't in the unit data today, and the composition model has no "mutually-exclusive variant line" concept. Needs: (a) a source/data representation of the sergeant variants + the variant lock, and (b) a composition feature for variant groups (related to the Astra Militarum preset-tier work). A12 gives Veterans basic steppers in the meantime; B4 makes it rules-correct.

---

## Recommended sequencing (within Immediate)

1. **Quick correctness/display wins:** A2, A7, A8, A6 (all S).
2. **Points & validity core:** A1, then A4, then A3 (A4/A3 share the equipped-weapon counting helper — build it once).
3. **UX refactor:** A5 (do after the control set is stable so targeted updates cover the final markup).
4. **Detachment panel:** A9–A11 together.
5. **Composition:** A12.

## Open decisions for your input
1. **A3 scope:** include armour→weapon-availability filtering in this pass, or defer it? (Related infrastructure, modest extra effort.)
2. **A5 approach:** invest in true targeted DOM updates now (cleanest, more work) vs. the scroll/accordion/tooltip-preserve interim (faster)?
3. **A4/A3 vs. speed:** these two are the heaviest immediate items and are pure correctness. Keep both in this increment, or ship the rest first and fast-follow with A3/A4?
4. **B4 (Veterans):** confirm it's acceptable for Veterans to have basic (non-locked) steppers via A12 until the rules-depth increment.
