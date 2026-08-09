# Alt-Hammer List Builder — Assessment & Redesign Plan

*Prepared June 2026. Supersedes the data/UI assumptions in `AltHammer-ListBuilder-DevPlan v1.2`
for the wargear/options subsystem. Builds on `docs/wargear-phrasing-audit.md`.*

**Confirmed direction (from review):**
1. **Source of truth:** a *controlled-grammar Word document* — Word stays the single authoring surface, but the Wargear/Armour/Standard-Wargear prose is normalised to a fixed, deterministically-parseable grammar.
2. **Engine fidelity:** a *full per-model loadout engine* (each model's equipment is tracked, not a unit-level approximation).
3. **Rollout:** *one faction end-to-end first*, then roll the proven pattern across factions.

---

## 1. Executive Summary

The current List Builder works at the shell level (three panels, faction load, add/remove, totals) but fails at its core job — *turning every legal in-unit choice into a clean, validated selection* — for four structural reasons:

1. It keeps **two divergent descriptions of every unit's options** (authoritative prose in `unit-profiles/*.json`, lossy structured data in `wargear/*.json`) and renders **both at once** → the "duplicate information" problem.
2. Its structured model is **too flat** (unit-level radio/checkbox groups) to express the real domain, which is **per-model loadouts** with conditionals, mutual exclusivity, compound picks, model transforms, and preset compositions.
3. Its data is produced by **brittle prose NLP** (`convert_wargear.py`, ~18 hand-written regex shapes) over free-form text that, by your own account, has more phrasing variants than anyone can enumerate → silent extraction errors.
4. Its **validation engine has correctness bugs** independent of the data (aggregate vs per-unit-name limits, no per-profile Force-Org overrides, no multi-model editing).

**The fix is not more regex.** It is a single structured representation of each unit's options — rich enough to (a) render the readable prose, (b) drive validated per-model selection, and (c) compute points — produced *deterministically* from a controlled grammar in the source document. The faction pages and the list builder then render from the *same* structure, so they can never disagree.

This document specifies that representation, the grammar contract, the engine, the UI model, the source-document revisions required, the pipeline changes, and a phased plan whose first increment proves the whole stack on one faction.

---

## 2. Diagnosis (evidence)

### 2.1 Dual, divergent representations rendered together
- `renderProfileAccordions()` in [list-builder-ui.js](../public/js/list-builder-ui.js) prints the prose section **and** appends structured controls (`_renderWargearControls`, `_renderStandardWargearGroups`, …) beneath it.
- The two sources disagree. Captain in [unit-profiles/adeptus-astartes.json](../src/data/unit-profiles/adeptus-astartes.json) lists 11 Primary Ranged weapons plus conditional/relic/storm-shield clauses; its [wargear/adeptus-astartes.json](../src/data/wargear/adeptus-astartes.json) `standardWargearGroups` lists ~5 **and mis-files "Tacticus Armour" as a ranged weapon**.

### 2.2 The model is too flat for the domain
The Honour Guard and Astra Militarum Infantry Section profiles (verified in the source `.docx`) require all of the following — none of which the current flat schema can represent:

| Real requirement | Example | Current schema |
|---|---|---|
| Per-model **independent** loadouts | "Every model must be equipped with 1 of the following Primary Ranged weapons" (3 models → up to 3 different) | one unit-level radio |
| **Mutually-exclusive** alt loadouts | "Instead of selecting a Primary Ranged weapon and Primary Melee weapon, any model can instead be equipped with: …" | not representable |
| **Conditional** availability | "Every model … equipped with a Boltgun or Bolt Rifle can be equipped with an Occulus"; "If the unit is equipped with Phobos Armour …" | not representable |
| **Compound** option | "Storm Bolter and Cyclone Missile Launcher"; "Demolition Charges and a Laspistol" | single weapon only |
| **Quantity** per option | "Up to 2 Honour Guard … can replace … " (each option pickable up to 2×) | single checkbox |
| **Model transform** | "2 Guardsmen can form a Heavy Weapons Team equipped with 1 Lasrifle and 1 of the following" | not representable |
| **Preset composition tiers** | "1 Sergeant and 9 Guardsmen, **or** 2 Sergeants and 18 Guardsmen" | free min–max stepper |

### 2.3 Extraction is brittle
[convert_wargear.py](../scripts/convert_wargear.py) `classify_intro()` is a ladder of ~18 regexes. `docs/wargear-phrasing-audit.md` already documents ~18 canonical types **plus** "ambiguous one-offs" and items explicitly marked *"cannot be represented in base schema."* Any unmatched sentence is silently dropped or misclassified.

### 2.4 Validation bugs (all in [list-builder.js](../public/js/list-builder.js) `validateForceOrg`)
- Character limit is computed per unit-name but the **message/logic conflate** "max per army" with aggregate counts; **Epic Hero blocks *all* epic heroes** once one is added rather than blocking only *that* named unit (Issues Log confirms).
- **No per-profile Force-Org overrides** are read (e.g. "1 per 2,000 pts"; Command Squad "1 per Senior/Junior Officer"). The data isn't even extracted.
- **Multi-model counts cannot be edited** for `range`-style squads via the centre panel, and preset tiers don't exist.

---

## 3. Target Architecture

```
        Faction Rules Index .docx  (controlled grammar)
                     │
        convert_units / convert_weapons (Excel) ── weapons[] + base stats
                     │
            convert_options.py  (deterministic grammar parser)
                     │
        ┌────────────┴─────────────┐
        ▼                          ▼
  src/data/units/{slug}.json   (rendered prose, generated)
  (canonical unit record:       → also feeds faction MDX pages
   stats, keywords, forceOrg,      so pages & builder never diverge
   composition, option CLAUSES)
        │
        ▼
   Loadout Engine (state, points)  ←→  Validation Engine (force org)
        │
        ▼
   UI: prose-with-controls accordions (single representation)
```

Three big moves:

1. **Collapse the option-bearing files into one.** Today there are three (`unit-profiles` prose, `wargear` structured, plus `faction-wargear` items). Target: **one canonical per-unit record** whose `sections[].clauses[]` are *both* the render source and the interaction source. `faction-wargear/*.json` stays as the **item/modifier library** (armour types, Relic/Twin-linked/etc.); weapons stay in `units.weapons`.
2. **Make the grammar a contract.** A finite set of sentence templates → deterministic parser. Anything that doesn't match is a **hard build error**, not a silent drop. This converts data corruption into loud, fixable authoring tasks.
3. **Model per-model loadouts.** The engine tracks each model's resolved equipment; points and validation derive from that.

### 3.1 The unit options model (canonical schema)

> Final field names are firmed up in the Increment-1 design task; this is the shape.

```jsonc
{
  "name": "Honour Guard",
  "category": "Battleline",
  "keywords": ["Imperium","Adeptus Astartes","Infantry","Battleline"],
  "epicHero": false,                       // from Excel keyword col (see §3.4)

  "forceOrg": null,                        // OR structured override, e.g.
  // "forceOrg": { "maxPer": { "points": 2000, "count": 1 } }
  // "forceOrg": { "onePer": ["Senior Officer","Junior Officer","Epic Hero"] }

  "composition": {
    "mode": "range",                       // "range" | "tiers"
    "range": { "min": 1, "max": 3 },
    "modelTypes": [
      { "name": "Honour Guard", "stats": { … }, "basePoints": 25 }
    ]
  },

  "sections": [
    { "key": "unitComposition", "prose": "<p>1 to 3 Honour Guard</p>", "clauses": [] },
    {
      "key": "standardWargear",
      "prose": "<p>Every model must be equipped with 1 of the following Primary Ranged weapons:</p>…",
      "clauses": [ /* clause objects, below */ ]
    },
    { "key": "specialAbilities", "prose": "…", "clauses": [] },
    { "key": "armourOptions",   "prose": "…", "clauses": [ … ] },
    { "key": "wargearOptions",  "prose": "…", "clauses": [ … ] },
    { "key": "leader",          "prose": "…", "clauses": [] }
  ]
}
```

**Clause** — one authored sentence + its parsed structure:

```jsonc
{
  "id": "wg-3",
  "prose": "Up to 2 Honour Guard in the unit can replace their Primary Ranged weapon with 1 of the following:",
  "op": "replace",                 // fixed | choose | add | replace | modifier | form-team
  "scope": {
    "who": "count",                // each | unit | count | ratio | role
    "modelType": "Honour Guard",
    "count": 2,                    // who=count
    "ratio": { "perX": 10, "n": 2 }, // who=ratio
    "requires": null               // OR { "armour": "Phobos" } | { "weaponKeyword": "Pistol" } | { "weaponIn": ["Boltgun","Bolt Rifle"] }
  },
  "replaces": { "slot": "primary-ranged" },   // { slot } | { weapon } | null
  "pick": { "min": 1, "max": 1 },             // pick-one / pick-any (max:null) / up-to-N
  "options": [
    { "ref": "weapon:flamer", "qty": 1 },
    { "ref": "weapon:storm-bolter", "qty": 1, "and": ["weapon:cyclone-missile-launcher"] },  // compound
    { "ref": "weapon:assault-bolter", "modifiers": ["twin-linked"] }                          // modifier
  ],
  "altGroup": null                 // clauses sharing an altGroup are mutually exclusive ("Instead of…/Alternatively…")
}
```

Why this shape works:
- **Renders prose** — `prose` is authoritative display text; the option list under it becomes the controls (no duplicate panel).
- **Drives per-model UI** — `scope.who` + `pick` say whether to show one control, a per-model control, a quantity stepper, or a ratio-capped counter.
- **Computes points** — every `options[].ref` resolves to a points value (weapon or faction-wargear item); `modifiers` apply cost formulas; `replaces` subtracts the displaced item.
- **Validates** — `scope.count` / `scope.ratio` / `pick.max` / `altGroup` / `requires` are exactly the constraints the engine enforces.
- **Special cases become first-class**, not "manual review": `op:"form-team"` (HWT), `and` (compound), `altGroup` (mutual exclusivity), `requires` (conditional), `modifiers` (Relic/Twin-linked).

### 3.2 The controlled grammar (authoring contract) + parser

`docs/wargear-phrasing-audit.md` already lists the canonical phrasings and recommended standard wording. Formalise that list into the **grammar spec** (`docs/wargear-grammar.md`): each `op`/`scope` combination has **exactly one** accepted sentence template, e.g.

| op / scope | Required sentence template |
|---|---|
| replace, each | `Every model can replace its [weapon] with 1 of the following:` |
| replace, count | `Up to [N] [modelType] in the unit can replace their [weapon] with 1 of the following:` |
| replace, ratio | `For every [X] models in the unit, up to [N] [modelType] can replace their [weapon] with 1 of the following:` |
| choose, each | `Every model can be equipped with 1 of the following:` |
| add, each (multi) | `Every model can be equipped with any of the following:` |
| add, single | `[subject] can be equipped with [item].` |
| modifier | `Any weapon equipped by this model can be upgraded to a [modifier].` |
| form-team | `For every [X] models in the unit, [N] [modelType] can form a Heavy Weapons Team equipped with [weapon] and 1 of the following:` |
| conditional | `If [predicate], [subject] can be equipped with 1 of the following:` |
| alternative | A clause prefixed `Instead of [clause-A], …` / `Alternatively, …` → shares `altGroup` with the preceding clause |
| compound option | list item `X and Y` → single option with `and` |
| quantity option | list item `Nx [weapon]` → option `qty:N` |

Parser (`convert_options.py`) behaviour:
- Walks the existing H5-unit / H6-section structure (which already parses cleanly).
- Matches each option paragraph against the template table → emits a clause. **No fuzzy fallback.**
- **Unmatched sentence ⇒ build error** listing faction/unit/line, so the doc gets normalised. (Tooling: `scripts/_dump_docx.py`, added during this review, dumps any `.docx` to text for auditing — keep it for grammar-conformance passes.)
- Resolves every option `ref` to a points value at build time; an unresolved ref is also a hard error.
- Emits the rendered `prose` per section **from the same clauses**, so faction MDX pages and the builder share one render path.

This is the single highest-leverage change: it makes the data *correct and complete by construction* instead of *best-effort*.

### 3.3 The per-model loadout engine

State per unit instance:

```jsonc
{
  "id": "u7",
  "unitName": "Honour Guard",
  "composition": { "tier": null, "counts": { "Honour Guard": 3 } },
  "models": [
    { "modelType": "Honour Guard",
      "loadout": { "primary-ranged": { "weapon": "Bolt Rifle" },
                   "primary-melee":  { "weapon": "Power Sword" },
                   "extras": ["Frag Grenades"] } },
    … one entry per model …
  ],
  "isWarlord": false
}
```

- **Points** = Σ over models of (`basePoints` + Σ slot/extra deltas − Σ replaced-item costs), modifiers applied per weapon. No more per-group affected-count guessing.
- **Serialization** stores only the *selections* (composition + per-model choices), recomputed against the catalog → keeps shared/export pages light (your A7 preference; no DB).
- **Derivation helpers** convert "each-model" clauses into per-model controls, "count/ratio" clauses into quantity counters with live caps from current composition.

### 3.4 Validation engine (corrected)

Rebuild `validateForceOrg` against confirmed rules (DevPlan Appendix A + your Q&A):

- **Per unit-name, not aggregate:** Character ≤ 1 per 1,000 pts *of that named unit*; General ≤ 2 per 1,000; Battleline ≤ 2 per 500. (Fixes the "too many characters" bug.)
- **Epic Hero (keyword):** ≤ 1 of *that specific named unit* per army, any battle size — block re-adding the same epic hero, **not** all of them (Issues Log). Source the flag from the Excel keyword column (DevPlan Q5 ⇒ `epicHero` boolean on the unit record).
- **Per-profile overrides:** read structured `forceOrg` (§3.1) — e.g. "1 per 2,000 pts", Command Squad "1 per Officer". Bespoke ones that can't be structured stay as prose + a soft warning.
- **Dedicated Transports:** allowance = count of units with **Infantry** keyword **excluding** Character/Mounted (your A8).
- **Titanic:** none < 1,500 pts; ≤ 1 per 1,000.
- **Warlord:** ≥ 1 Leader; exactly 1 Warlord designated.
- **Points cap:** total ≤ target.

### 3.5 UI model — one representation, readable *and* interactive

Resolves the duplication complaint by **merging prose and controls** (your Tier-2 A4):

- Right panel renders the unit profile as the site's accordion sections — **the same prose as the faction page** — via the shared render path.
- Inside `standardWargear` / `armourOptions` / `wargearOptions`, each **clause's prose is the control's label**, and its `options[]` render *inline beneath that sentence* as the selectable controls. There is no second, separate "options panel" duplicating the text.
- Control type is chosen from the clause: pick-one → radios; pick-any → checkboxes; count/ratio → quantity steppers with live caps; each-model → a compact per-model matrix (or per-model rows); modifier → an "upgrade this weapon" toggle attached to the selected weapon (makes Relic/Twin-linked target explicit — Issues Log).
- **Composition** lives at the top of the panel: a tier selector (`mode:"tiers"`) or per-model-type steppers (`mode:"range"`), with each model type showing its **own statline** (fixes the "one unlabelled statline" bug).
- Reuse existing tooltip JS ([keyword-tooltips.js](../public/js/keyword-tooltips.js), [ref-tooltips.js](../public/js/ref-tooltips.js)) on the rendered prose for keywords/weapons/wargear.

The existing three-panel shell, CSS, session-per-tab persistence, and faction loader are **kept** — the rebuild is data model + parser + engine + the options-panel renderer, not the whole app.

---

## 4. Required source-document revisions

These are the "fundamental revisions to the core rules documentation" the redesign depends on. They are **authoring/format** changes, not rules changes — and they make the document its own single source of truth.

1. **Normalise every per-unit option sentence to the grammar** (§3.2 / audit). One template per construction; no free variation. This is the bulk of the effort and is done faction-by-faction alongside the build.
2. **Standardise the H6 headings:** use **"Wargear Options"** everywhere; retire "Weapon Options" (19), "Wargear Upgrades" (60) as unit sub-headings; keep **"Armour Options"** as a distinct sub-heading (it must stay separate — it drives weapon availability).
3. **Encode compositions explicitly:** preset tiers as `"A, or B"` lines; ranges as `"[min] to [max] [unit]"`. Consistent wording so the parser builds `composition`.
4. **Make conditionals/alternatives explicit and adjacent:** `If [predicate], …`, `Instead of …`, `Alternatively, …` immediately following the clause they modify.
5. **Compound & quantity options:** `X and Y` for compound; `Nx [weapon]` for quantity — applied consistently (e.g. the Predator "2× each" case from your Tier-2 A6).
6. **Structured Force-Org overrides:** keep the existing "Force Organization" H6 prose, but phrase the common cases (`1 per [N] pts`, `1 per [unit type]`) so they parse; the parser must **read this section** (currently dropped).
7. **Faction-wargear modifiers** (Relic/Accursed/Master-Crafted/Twin-linked): keep in the H3 Wargear Upgrades section; the parser injects them onto units as `modifier` options where the unit's prose grants them (your Tier-2 A7, option *a* — pipeline-side, no runtime mapping).

> Workflow note (answers your Tier-2 A5): the `wargear/*.json` and `unit-profiles/*.json` files were **machine-generated** by the pipeline, not hand-authored — they just drifted because the parser was lossy. Under this plan there is **nothing to hand-edit**: normalise the Word doc, run the pipeline, both the faction pages and the builder update together.

---

## 5. Pipeline changes

| Script | Change |
|---|---|
| `convert_options.py` (**new**) | Replaces `convert_wargear.py`. Deterministic grammar parser → canonical `sections[].clauses[]` + rendered `prose`; reads Force-Org H6; injects faction modifiers; **hard-errors** on unmatched sentences/refs. |
| `convert_units.py` / `convert_weapons.py` | Add `epicHero` (keyword col) + ensure weapon `availability` keyword is present for armour filtering. |
| `convert_factions.py` | Faction-page Unit Profile prose now rendered from the **same** clause render path (shared module) so pages and builder match exactly. |
| `convert_faction_wargear.py` | Keep; ensure modifier items expose cost/cost-formula (Twin-linked formula already in `convert_wargear.py` — port it). |
| `convert_detachment_traits.py` | Add `category`, `pointsCost`, `maxPerCategory`, `mutuallyExclusiveWith` (Issues Log: subsections + caps). |
| `run_all.py` | Swap in `convert_options.py`; move the hardcoded Windows source paths to one config block (DevPlan §7.2). |

Deprecate (after migration): `src/data/wargear/`, `src/data/unit-profiles/` (merged into `units`).

---

## 6. Phased plan

### Increment 0 — Design lock (small) — ✅ DONE
- Schema finalised and grammar contract written: **`docs/wargear-grammar.md`** (canonical record, clause object, slot taxonomy, template table, force-org vocabulary, and the AA normalization worklist).
- Proof faction **confirmed: Adeptus Astartes** (armour→availability dependency, combi nested picks, Relic/Twin-linked modifiers, per-model picks, conditionals, pick-N-distinct, per-weapon upgrades). **Astra Militarum second** (preset tiers, ratio caps, Heavy-Weapons-Team transform).

### Increment 1 — One faction, end-to-end (large; the proof)
1. Normalise the chosen faction's Wargear/Armour/Standard/Force-Org sections to the grammar.
2. Build `convert_options.py` to the schema; pass for that faction with **zero unmatched** (hard-error gate).
3. Build the loadout engine (state, per-model points) + corrected validation.
4. Build the merged prose-with-controls options panel + composition controls.
5. Verify against the source by hand for ~5 representative units (Captain, Intercessors, Honour Guard, a vehicle, an Epic Hero).

### Increment 2 — Second faction (Astra Militarum) (medium)
- Extend grammar/parser/engine for tiers, ratios, and `form-team`. This closes the hardest patterns; after this the model is proven complete.

### Increment 3 — Roll out remaining factions (medium, repetitive)
- Per faction: normalise doc → run pipeline → spot-check. Engine/UI shouldn't need changes (DevPlan §7.4 — new factions are data-only).

### Increment 4 — Detachment traits depth + niceties (medium)
- Trait subsections, DP caps, mutual exclusivity, in-context rules view (Issues Log).
- Browser: ±10 buttons + keep presets (Tier-2 A1/A2); fix/remove per-model points display; move "Unit Browser" heading (Issues Log).

### Increment 5 — Export / share (medium; DevPlan Phase 3)
- Light static export page from selections only (your A7); copy-to-clipboard text.

> Deferred per your Q&A: allied factions (A4), detachment-trait *mechanical effects* on stats/points (A9 — display now, enforce later), multi-list management (A6).

---

## 7. Issues Log → resolution map

| Issues-Log item | Resolved by |
|---|---|
| Army size selector (±10 + presets) | Inc 4 |
| "Unit Browser" heading placement | Inc 4 |
| Per-model points wrong/0 in browser | Inc 4 (compute from min composition, or remove) |
| Detachment trait subsections + caps + rules view | Inc 4 (schema + UI) |
| "Too many characters" aggregate bug | Inc 1 (§3.4 per unit-name) |
| Per-profile Force-Org overrides ignored | Inc 1 (`forceOrg` extraction + engine) |
| Multi-model add/remove; preset tiers; per-type statlines | Inc 1 (composition model + UI) |
| Tooltips for keywords/weapons/wargear | Inc 1 (reuse on rendered prose) |
| Standard Wargear "choose one" treated as all-required | Inc 1 (clause `op:"choose"`) |
| Missing options / "Nx weapon" multipliers | Inc 1 (grammar `qty`) |
| Twin-linked / Master-Crafted / Accursed modifiers | Inc 1 (`modifier` options, pipeline-injected) |
| Relic Weapon: unclear target | Inc 1 (modifier attached to a chosen weapon slot) |
| Epic Hero blocks all instead of same-name | Inc 1 (§3.4) |
| Armour Options separated + drives weapon availability | Inc 1 (armour slot sets availability keyword; weapons filtered) |
| Combi-Bolter / Kombi-Shoota nested picks | Inc 1 (`requires`/nested clause; Kombi = pick-any, Combi = pick-one) |
| Per-model-count / ratio need multi/qty selection (Honour Guard ×2) | Inc 1 (quantity steppers) |

---

## 8. Risks & open decisions

- **Doc normalisation effort is the real cost.** It's front-loaded and manual, but it's also the thing that makes everything else deterministic. The hard-error gate keeps it honest. Mitigation: do it per-faction, gated by the parser.
- **A few patterns may resist clean grammar** (e.g. Ogryn double-pick, Squadron Commander mounting). Allowance: a small `op:"manual"` clause that renders prose + a free note, with points entered as a fixed adder — used sparingly and reported at build time.
- **Weapon `availability` coverage** must be confirmed complete in the weapons data for armour-filtering to work (verify in Inc 1).
- ~~**Decision for Increment 0:** confirm Adeptus Astartes as the proof faction.~~ ✅ Confirmed: Adeptus Astartes first, Astra Militarum second.

---

## Appendix — files touched

- **Keep/extend:** `src/pages/list-builder.astro`, `public/styles/list-builder.css`, `public/js/keyword-tooltips.js`, `public/js/ref-tooltips.js`, `src/data/units/*.json`, `src/data/faction-wargear/*.json`, `src/data/detachment-traits/*.json`.
- **Rewrite:** `public/js/list-builder.js` (engine+validation), `public/js/list-builder-ui.js` (merged renderer).
- **New:** `scripts/convert_options.py`, `docs/wargear-grammar.md`, shared clause→prose render module (used by both `convert_factions.py` and the builder).
- **Deprecate after migration:** `scripts/convert_wargear.py`, `src/data/wargear/`, `src/data/unit-profiles/`.
