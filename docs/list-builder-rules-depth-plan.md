# List Builder — Rules-Depth Increment: Implementation Plan

*Prepared 2026-06-27 for review/approval. Follows the redesign + Increments B/C/D.*
*Revised 2026-06-30: mechanical effects for wargear upgrades & detachment traits are now sourced from a dedicated tabulated workbook — see “Source of truth & data pipeline” below. This removes the prose-normalisation workstream and materially de-risks R1/R3/R4.*
*Companions: `docs/list-builder-redesign-plan.md`, `docs/wargear-grammar.md`, `docs/list-builder-issues-2026-06-25-plan.md`.*

## What this increment is

Everything so far has treated each selection as a **points + validity** decision. The Rules-Depth increment adds the layer where a selection produces **downstream rule effects** the builder must reflect:

- **armour types** that change a model's statline, grant keywords/abilities, and gate which weapons are available;
- **detachment traits** that have a **points budget + category caps + mutual-exclusivity**, and that **modify unit statlines / keywords / points / category** when chosen;
- **variant-locked composition** (Veterans: Sternguard ⊻ Vanguard).

The unifying new concept is a **structured Effects model** + a **live statline-resolution layer**: selections (armour, traits) carry structured stat/keyword/points deltas, and the builder computes each model's *displayed* profile (and *resolved* keywords for validation, and *adjusted* points) by applying the active effects on top of the base data.

> **Authoring update (supersedes the original prose-normalisation plan):** the first draft assumed armour/trait effects would be parsed from prose in the Faction Rules Index and normalised to a controlled vocabulary (à la `docs/wargear-grammar.md`). That workstream is **no longer needed.** The mechanical effects are now authored directly as structured columns in a dedicated per-faction workbook (see *Source of truth & data pipeline* below), so the pipeline ingests a table deterministically instead of parsing sentences — removing the single largest correctness risk from this increment.

---

## Source of truth & data pipeline

**New source file:** `Alt-Hammer 40,000 1st Edition - Wargear Upgrades and Detachment Traits by Faction.xlsx` (one sheet per faction). This is the **authoritative source for the mechanical effects** of both Wargear Upgrades and Detachment Traits, and it supplies the structured Effects/selection data this increment consumes. Its columns map almost 1:1 onto the schemas below, so ingestion is deterministic (no sentence parsing).

**Division of authority — which file owns what:**
- **Upgrades & Detachment Traits workbook (new)** → *mechanics*: permanent stat deltas, keyword add/remove, points changes, targeting/eligibility, and detachment selection rules (budget, cost, caps, exclusivity).
- **Faction Rules Index `.docx`** (via `convert_faction_wargear.py` / `convert_detachment_traits.py`) → *prose/display*: full rules text and tooltips, combi `nestedChoice`, and any **situational / non-permanent** effects the table intentionally omits. These are shown in the builder and faction pages and read by the player; the engine does not model them.
- **Unit data** (`src/data/units`) → *availability*: which units offer which upgrades, and weapon-selection limits by keyword. The workbook does **not** gate per-unit access (its `Eligibility` gates by model keyword only, e.g. armour requires `Tacticus`).

**Scope of the table (per the author):** only **permanent** modifications to statlines/attacks are captured. Situational/non-permanent modifiers and rules with no statline interaction are deliberately left out and remain prose display text.

**Workbook structure the pipeline reads:**
- *Identity:* `ID` (kebab-case; the grouping key — **multi-row items share one ID**), `Category`, `Subcategory`, `Name`, `Points Cost`.
- *`Points Cost`:* bare signed number = additive delta; `xN` = multiply the base cost of the item's target domain (Twin-linked `x1.5` multiplies the weapon's cost).
- *Selection Rules* (trait rows): `Detachment Points Cost`, `Subcategory Cap`, `Exclusivity Group`; plus a faction-level **Detachment Points Budget** cell (row 2).
- *Applies To:* `Eligibility (Who)` (OR-list separated by `|`, `+` for AND; blank = any), `Target Domain` (`model` | `weapon` | `unit`), `Target Filter` (bare typed tokens — see below).
- *Model Statline Effects:* Activation Points, Movement, WS, BS, Initiative, Attacks, Strength, Toughness, Wounds, Save, Leadership.
- *Weapon Statline Effects:* Range, Attacks, Strength, Armour Piercing, Damage.
- *Keyword Effects:* Keywords Added, Keywords Removed.
- *Delta vs set convention:* a bare signed number is a delta (`+1`/`−1`); a value carrying a unit/suffix is a *set* (`2+` save, `12"` movement).

**Target Filter — bare tokens, classified deterministically** (no author-typed type prefixes):
1. contains a comparator (`<`,`>`,`>=`,`<=`) → weapon-stat threshold (`Strength<9`, `Strength>=9` — `>=` closes the S9 boundary);
2. `Ranged` / `Melee` → weapon class / attack scope;
3. matches the weapon-keyword vocabulary → weapon keyword (`Torrent`, `Melta`);
4. matches the weapon-name list → weapon name (`Boltgun`, `Bolt Rifle`).

The converter **hard-errors** on a token that matches zero categories or is ambiguous (matches >1), preserving the deterministic-parse guarantee. (Name vs keyword vocabularies verified disjoint for current AA data.)

**New converter — `convert_upgrades.py`:** reads the workbook and emits structured `effects` + `selection` blocks keyed by `ID`, merged onto the existing faction-wargear items and detachment-trait entries (joined by slug/ID) so downstream JSON consumers stay stable. It supersedes the *mechanical* role previously scoped for the prose converters; those keep producing prose/display + combi data.

**Pipeline rules the data necessitates:**
- **De-duplicate by `ID`** when counting DP budget and Subcategory Cap — multi-row items (e.g. `1st-comp`, `twin-linked`) repeat their `Detachment Points Cost`/`Subcategory Cap` on each row; count the item once.
- **Multi-row precedence:** within one `ID`, when more than one row's requirements match a given weapon/model, the **top-most row wins** (author rows most-specific-first).
- **Resolve armour keyword changes before equipment eligibility:** equipment `Eligibility` (e.g. Artificer's `Tacticus | Gravis`) is tested against the model's **resolved** keywords, after any armour swap has applied its add/remove.

---

## Foundation — structured Effects + statline resolution

A shared representation consumed by both armour and traits.

**Effect schema** (built by `convert_upgrades.py` from the workbook columns — one entry per row, grouped by `ID`):
```jsonc
"effects": {
  "modelStats":  [ { "char": "T", "op": "inc", "value": 1 }, { "char": "SV", "op": "set", "value": "2+" } ],
  "weaponStats": [ { "char": "A", "op": "inc", "value": 1 } ],    // Weapon Statline Effects columns
  "keywords":    { "add": ["Implacable"], "remove": ["Tacticus"] },
  "points":      { "op": "delta", "value": -10 },                 // or { "op": "mult", "value": 1.5 }
  "target":      {                                                // from the Applies To columns
    "eligibility": ["Tacticus", "Gravis"],                        //   OR-list (blank = any)
    "domain":      "model",                                       //   model | weapon | unit
    "filter":      { "kind": "weaponClass", "values": ["Melee"] } //   classified from the bare token
  },
  "raw":         [ "...prose lines from the Word doc — full / situational rules for display..." ]
}
```
- `char` ∈ the statline keys; `op` ∈ inc/dec/set — `set` carries a suffixed value (`2+`, `12"`), inc/dec a bare number. `weaponStats` apply when `domain: weapon`.
- `points.op` ∈ `delta` (signed add) | `mult` (multiply the target domain's base cost).
- `raw` is sourced from the Word doc (full/situational rules) and always surfaced as display text — the workbook holds only **permanent** mechanical effects, so the prose remains the player-facing rules.

**Selection schema** (detachment traits — from the Selection Rules columns + the budget cell):
```jsonc
"selection": { "detachmentPointsBudget": 2,        // faction-level (row 2 cell)
               "detachmentPointsCost": 1, "subcategoryCap": 1, "exclusivityGroup": null }
```

**Engine — resolution helpers (new):**
- `resolvedStats(entry, modelType)` → base stats with active **model** deltas applied (selected armour/equipment + trait stat effects whose `target` matches the unit's resolved keywords).
- `resolvedWeapon(weapon, upgrades)` → a weapon profile with active **weapon-domain** upgrades applied (Relic +A/+S/+D, Twin-linked, Occulus), respecting each upgrade's `target.filter`.
- `resolvedKeywords(entry)` → base keywords + armour/trait add/remove (used by validation **and** display); computed **before** equipment `eligibility` is tested (armour changes keywords that gate equipment).
- `pointsAdjust(entry)` → per-unit/model points deltas + weapon-cost multipliers, folded into `calcUnitPoints`.
- `validateDetachment(entry)` → budget / cap / exclusivity, **counting each trait `ID` once** (multi-row traits repeat their cost/cap).

**Scope note (AA is clean):** because AA armour is uniform per unit (single-model characters, or `who:unit` for squads), each model type has a single well-defined resolved statline. (Heterogeneous per-model armour would be ambiguous — not present in AA; we'll show base + a note if it ever appears.)

*Effort: **L** — this is the spine the armour/trait workstreams hang on.*

---

## R1 · Armour types modify the statline *(M, on the foundation)*
**Today:** selecting Phobos/Gravis/Terminator changes points only; the displayed statline stays at base.
**Goal:** the stat block reflects the selected armour (e.g. Gravis: T+1, M−1", I−1, +Implacable), and granted keywords/abilities show as chips/notes.
**Work:**
- *Pipeline:* `convert_upgrades.py` reads the Astartes Armour/Equipment rows into the Effects schema straight from the columns (Gravis → `modelStats:[{T,inc,1},{M,dec,1},{I,dec,1}]`, `keywords.add:[Gravis,Implacable]`, `keywords.remove:[Tacticus]`, `points:{delta,8}`). No prose parsing.
- *Engine:* `resolvedStats`/`resolvedKeywords` apply the selected armour's effects.
- *UI:* `renderStatRow` renders resolved stats (with a subtle "modified" affordance); resolved keyword chips; armour-granted abilities listed.

## R2 · Armour → weapon-availability filtering *(M, self-contained — recommended first)*
**Today:** all weapon options show regardless of armour. (Deferred from Increment B / A3.)
**Goal:** when a model's armour is selected, only weapons whose `availability` includes that armour keyword are offered; already-picked weapons that become invalid are flagged/cleared.
**Work:**
- *Engine:* `weaponAvailable(weaponName, armourKeyword)` against the existing comma-separated `availability` field; an option is hidden/disabled when the unit's armour excludes it; clamp on armour change (reuse the `_clampConditionals` pattern).
- *UI:* filter/disable weapon option rows by current armour; show a one-line "requires <armour>" affordance, consistent with the conditional-gating UX from Increment B.
- *No new data for weapon availability* — the weapon `availability` field already exists on every weapon. **This makes it the cleanest first win.** (Distinct from the workbook's `Eligibility`, which gates which model may *take an armour/upgrade* — see R1.)

## R3 · Detachment-trait selection rules *(M)*
**Today:** traits are free-select checkboxes; no budget, caps, or exclusivity. (Issues Log 2026-06-25.)
**Goal:** enforce the detachment-points budget, per-category caps, and mutual exclusivity.
**Work:**
- *Pipeline:* the selection rules are now authored as columns — `convert_upgrades.py` reads the faction **Detachment Points Budget** (row 2) and each trait's **Detachment Points Cost**, **Subcategory Cap**, and **Exclusivity Group**, de-duplicating multi-row traits by `ID`. (Supersedes the prose extraction previously scoped for `convert_detachment_traits.py`, which now only supplies trait display prose.)
- *Engine:* `validateDetachment()` — DP spent ≤ budget; ≤ cap per subcategory; respect exclusivity groups; a `canSelectTrait(id)` guard. Counts each trait `ID` once.
- *UI:* show DP used/budget, disable over-budget / over-cap / excluded traits, surface violations in the army status line. (Panel layout/accordions from Increment B stay.)

## R4 · Detachment traits modify units *(M — substantially de-risked by tabulation)*
**Today:** trait rules are shown as accordion text only.
**Goal:** a chosen trait's mechanical effects apply to the affected units — statline/keyword changes, keyword-targeted (e.g. *"Mounted units gain Relentless and Unyielding"*; *"Veterans gain Battleline while Intercessors lose it"*; weapon-scoped grants like Born-in-the-Saddle → Lance on Mounted melee weapons).
**Work:**
- *Pipeline:* trait effects are now **tabulated**, not prose — `convert_upgrades.py` reads each trait row's Model/Weapon/Keyword effect columns plus its `target` (`Eligibility` = affected units, `Target Domain`, `Target Filter`). No normalisation grammar, and **the phrasing audit is no longer needed**. Situational / in-game-only effects are simply absent from the table and remain `raw` display prose from the Word doc.
- *Engine:* fold active-trait effects into `resolvedStats` / `resolvedWeapon` / `resolvedKeywords` / `pointsAdjust`, applying each effect only to units whose resolved keywords match `target.eligibility`; **validation uses resolved keywords** (so a trait that grants/removes Battleline changes that unit's force-org limit).
- *UI:* affected units show modified statlines/keywords (shared with R1's renderer) and any points delta in their total.
- *Note:* the earlier "largest normalisation effort / most manual fallbacks" risk is retired by the tabulation; the remaining effort is the runtime keyword-targeted application, shared with R1.

## R5 · Variant-locked composition (Veterans) *(S — runtime-only, no data change)*
**Today:** Veterans shows independent steppers for Sternguard and Vanguard (Increment A12 basic).
**Goal (per A5):** the unit is **either** 3–5 Sternguard **or** 3–5 Vanguard — never a mix. No Sergeant model variants are added; the unit's existing model options are sufficient.
**Work:**
- *Data:* none — no Excel/source changes. A `composition.mode: "variant"` flag marks the two existing model groups as mutually exclusive.
- *Engine:* incrementing one line locks the other to 0; enforce the chosen line's min/max (3–5 — confirm against the unit data); block any total drawn from both lines; a reset returns to the neutral (either-allowed) state.
- *UI:* keep the two existing steppers; disable the non-chosen line once the other is in use, with a one-line "Sternguard or Vanguard, not both" affordance.

---

## Explicitly **out of scope** for this increment
- **Astra-Militarum structural features** — Heavy Weapons Team model-transforms and preset composition tiers. These are *faction-expansion* work (needed when AM is tackled), not rules-depth, and are tracked separately. R5's `variant` composition is the only structural item here because it's AA.
- **Allied factions** (deferred since Phase 1).

---

## Recommended sequencing
1. **`convert_upgrades.py` — ingest the workbook.** Build the one converter that emits the `effects` + `selection` blocks (Target-Filter classifier + hard-error gate, ID de-duplication, delta/set + points conventions). This single step supplies the data for R1, R3 **and** R4 at once — the prose-normalisation formerly spread across those workstreams collapses into this ingest.
2. **R2 — availability filtering.** Self-contained, uses the existing weapon `availability` field; proves the armour→selection dependency pattern.
3. **Foundation + R1 — armour statlines.** Build the statline-resolution spine (`resolvedStats` / `resolvedWeapon` / `resolvedKeywords`) on the ingested armour/equipment effects.
4. **R3 — detachment selection rules.** Budget/cost/caps/exclusivity come straight from the ingested `selection` block; build `validateDetachment` (counting each `ID` once).
5. **R4 — trait effects.** Reuses the Foundation + the ingested trait `effects`/`target`; no longer the big risk — the effort is the keyword-targeted runtime application, shared with R1.
6. **R5 — Veterans variant-lock.** Independent composition feature; can slot in any time.

## Decisions (resolved 2026-07-01)
1. **Effect-type scope** — structure & apply **stats + keywords + points + availability** now; abilities (Scout/Infiltrator) shown but informational. → **Proceeding (recommended approach).**
2. **Enforce vs display for traits (R4)** — apply list-construction-relevant effects (points, keyword/category changes that hit force-org) and reflect stat changes in the displayed profile; purely in-game effects stay as accordion text. → **Proceeding (recommended approach).**
3. **Effects authoring** — effects are authored as structured workbook columns; deterministic ingest, hard-error-gated. No prose normalisation.
4. **R4 depth** — full structured trait effects in **one pass** (no R4a/R4b split). → **Proceeding.**
5. **R5 variant lock** — **No** Sergeant model variants added to the source. The unit is either 3–5 Sternguard or 3–5 Vanguard; the builder must prevent selecting from both step-selectors within one unit instance (runtime mutual-exclusivity — see R5).