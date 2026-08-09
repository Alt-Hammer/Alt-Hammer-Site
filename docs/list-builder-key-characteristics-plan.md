# Key Unit Characteristics — List Builder Implementation Plan

*Status: **IMPLEMENTED** (2026-08-07). Source edits applied by the author; code shipped and
verified. The grammar is now documented in `docs/wargear-grammar.md` §1.1, §3.8, §6.1 and
§7.6 — that file is the contract; this one is the record of why. See §12 for what shipped.*
*Companion to `docs/wargear-grammar.md` (the authoring contract) and `docs/list-builder-redesign-plan.md`.*

A **key unit characteristic** is a list-building selection made *within* a unit that
confers an array of changes on that unit or model — wargear, abilities, keywords,
statline, points, and (for display) the units it may lead. First instances:
Necron *Path of Study* and *Harnessed God*, Ork *Gorkanot / Morkanot* type, T'au
*Shaper's Path*, Asuryani *Paths of the Aspect Shrines*.

---

## 1. Audit — what exists today

### 1.1 The five instances

| Faction / unit | Rule (H6 heading) | Cardinality | Confers | Points source |
|---|---|---|---|---|
| Necrons / **Mantic** | Path of Study | exactly 1 of 4 | weapon + wargear, 1 ability | the granted items |
| Necrons / **Shard of Transcendent C'Tan** | Harnessed God | exactly 1 of 4 | weapon(s) (one option: none), 1 ability | the granted items |
| Orks / **Gorkanot / Morkanot** | *(inside Standard Wargear)* | exactly 1 of 2 | a fixed weapon list | the granted items |
| T'au / **Kroot Shaper** | Shaper's Path | exactly 1 of 3 | **nested sub-choices** (2× "1 of the following"), abilities | the chosen weapons |
| Asuryani / **Autarch**, **Annatharch** | Paths of the Aspect Shrines | up to 4 / up to 2, of 8 | 1 ability + a Leader-list expansion; **no wargear** | explicit flat 10 pts each |

### 1.2 What the List Builder sees today: **nothing**

All five are invisible to the builder, by two separate mechanisms:

1. **Unrecognised H6 headings are silently dropped.** `H6_MAP` in
   `scripts/convert_options.py:69` is a closed table; the walk at
   `scripts/convert_options.py:1359` sets `cur_sec = None` for anything not in it and
   never buffers those paragraphs. *Path of Study*, *Harnessed God*, *Shaper's Path* and
   *Paths of the Aspect Shrines* all vanish before any parsing happens. Documented as a
   known trap in `docs/wargear-grammar.md` §1.1 — this is that trap firing.
2. **H7/H8 paragraphs are discarded unconditionally.** `scripts/convert_options.py:1365`
   resets `cur_sec = None` on level 7 and 8. So even the Gorkanot, whose block sits
   under a *recognised* `Standard Wargear` H6, keeps only its intro sentence — its
   `standardWargear` section has `clauses: []`.

Verified against the generated data:

```
Mantic              sections: unitComposition, specialAbilities, wargearOptions, leader   (no Path)
Shard of … C'Tan    sections: unitComposition, forceOrganization                          (no wargear at all)
Gorkanot/Morkanot   standardWargear.clauses = []                                          (no weapons at all)
Kroot Shaper        sections: unitComposition, forceOrganization, wargearOptions, leader  (no Path)
Autarch/Annatharch  no Paths section; upgradeAllowance = undefined
```

### 1.3 The blast radius is wider than these five

Enumerating every H6 inside a unit profile that `H6_MAP` does not recognise gives **26**
silently-dropped sections:

| Count | Heading | Nature |
|---|---|---|
| 14 | `Gifts of Chaos` (Chaos Undivided) | Prose *declaring* the catalog allowance — the mechanic works (workbook-driven) but the unit-side explanation is dropped |
| 2 | `Paths of the Aspect Shrines` (Autarch, Annatharch) | This plan |
| 2 | `Asuryani Psychic Powers` (Farseer, Warlocks) | A *different* selection feature — out of scope, see §11 |
| 1 | `Shaper's Path`, 1 `Path of Study`, 1 `Harnessed God` | This plan |
| 1 | `Ridgehauler Trailers` (GSC Land Train) | Plain prose rules; needs only to stop being dropped |
| 4 | `Abilities` (Necrons: Hexmark Destroyer, Canoptek Scarabs / Spyder / Reanimator) | **Authoring typo** — should be `Special Abilities`; those units' abilities are missing from the builder |

The last row is a free win and an argument for the §5.1 change: **an unrecognised H6
should be a hard error, not a silent drop.**

### 1.4 Points impact

Standard Wargear is billed *on top of* `basePoints` today (Royal Warden: 80 base + 8 for
its Gauss Blaster). Applying the same rule to key characteristics is a large correction:

| Unit | Base | Per-choice addition | Resulting spread |
|---|---|---|---|
| Mantic | 85 | Technomancer 70 · Psychomancer 50 · Chronomancer 35 · Plasmancer 25 | **110 – 155** (shown as 85 today) |
| Shard of Transcendent C'Tan | 400 | Nightbringer 120 · Void Dragon 75 · Deceiver 50 · Unformed 0 | **400 – 520** (shown as 400 today) |
| Gorkanot / Morkanot | 200 | full weapon suite either way, incl. 2× Twin-linked pairs | ≈ **+150** either branch |
| Kroot Shaper | 50 | 6–20 depending on Path and its sub-picks | **56 – 70** |
| Autarch / Annatharch | 110 / 90 | 10 per Path, up to 4 / 2 | **110–150 / 90–110** |

**This is the single biggest reason to do the work**: four units are currently
under-costed in the builder by 25–120 points each, and two have no weapons at all.

---

## 2. Taxonomy — one shape, two option sources

The five instances split cleanly on **where the option pool lives**, not on what it does:

- **Unit-specific pool** (Mantic, C'Tan, Gorkanot, Kroot Shaper) — the options exist only
  for that unit, are defined inline under it, define its *wargear*, and are priced by
  the items they grant.
- **Faction-shared pool** (Asuryani Paths) — one pool consumed by several units, each with
  its own cap, priced per pick. This is **structurally identical to Gifts of Chaos**,
  which already ships: a faction `upgrade-catalog` + a per-unit `Upgrade Allowance`.

### The authoring rule of thumb (for units not yet written)

> **Does the choice decide what the model is armed with?** → inline key characteristic (§3.1).
> **Is it a priced pick from a pool that several units draw on?** → faction upgrade catalog + `Upgrade Allowance` (§3.2).

### Recommended standardisation

Rather than build one mechanism that does both (which would duplicate the working gifts
engine), standardise the **three things the author touches** so both feel like one feature:

1. **One section slot** — every key characteristic is its own H6 under the unit, whatever
   its flavour name.
2. **One intro-sentence template** — the same "must/can select N of the following …"
   grammar declares both kinds, and *which kind it is* falls out of whether H7 blocks
   follow (inline) or the label names a faction catalog (shared).
3. **One UI block** — both render as the same selector directly under the statline,
   above Standard Wargear.

Only the option **definitions** live in different places, which is exactly the real
semantic difference. Chaos already authors a `Gifts of Chaos` H6 per unit — this makes
that existing instinct load-bearing instead of dropped.

---

## 3. Standardised authoring convention

### 3.1 Inline key characteristic (unit-specific pool)

```
H6   <Flavour name>                       ← free-form: "Path of Study", "Harnessed God"
     <intro sentence — see template below>
  H7   <Option name>                      ← "Technomancer", "Shard of the Deceiver"
    H8   Wargear:                         ← ordinary §3 wargear sentences + lists
    H8   Abilities:                       ← prose
    H8   Leader:                          ← prose (optional; display-only, see §11)
```

**Intro template** (deliberately loose after the comma, mirroring the blanket-modifier
sentence in `wargear-grammar.md` §3.5):

```
[This model | This unit | Each <Unit> unit] must select [N] of the following <label>, <free tail>.
[This model | This unit | Each <Unit> unit] can select up to [N] of the following <label>, <free tail>.
```

`must` → `pick.min = N`; `can … up to` → `pick.min = 0`. All four existing intros match
this with only light edits (§8). The H6 heading text is the display label; the tail
("…which determines its Wargear and Abilities as described") stays reader-facing prose.

An H8 block is recognised by its label — `Wargear`, `Abilities`, `Leader` (trailing colon
optional). `Wargear:` content is parsed with the **existing, unmodified** clause grammar,
so a Path may contain fixed items *and* nested "1 of the following" lists (Kroot Shaper)
with no new grammar.

An option with no `Wargear:` block (Unformed Shard) is legal and grants nothing.

### 3.2 Catalog-backed key characteristic (faction-shared pool)

```
H6   <Catalog name>                       ← must match the workbook Category exactly
     [This model | This unit] can select up to [N] of the following <label>, <free tail>.
```

No H7 blocks. The parser resolves the H6 heading against the faction's
`upgrade-catalogs/{slug}.json` categories; the cap comes from the sentence.

**This makes the prose the source of truth for the allowance**, replacing (or
cross-checking) the `Upgrade Allowance` workbook column. Two sub-options, see §10 Q3.

---

## 4. Canonical data schema

A new section object, emitted into the existing `options.sections[]` array. **Multiple
per unit are allowed** (each carries its own `id`), so the UI must key them by `id`, not
by `key`.

```jsonc
{
  "key": "keyCharacteristic",
  "id": "path-of-study",              // slug of the H6 heading — namespaces everything below
  "label": "Path of Study",           // H6 heading text, verbatim
  "prose": "<p>Each Mantic unit must select 1 of the following …</p>",
  "select": { "min": 1, "max": 1 },   // from the intro template
  "scope": "unit",                    // "unit" (all models share one) | "model" (per-model) — see §10 Q2
  "source": "inline",                 // "inline" | "catalog"
  "catalogId": null,                  // set when source = "catalog"

  "profiles": [                       // present when source = "inline"
    {
      "id": "technomancer",
      "name": "Technomancer",
      "points": null,                 // explicit adder if authored; null = priced by its clauses
      "clauses": [ /* ordinary §2 clause objects, ids prefixed "path-of-study-technomancer-…" */ ],
      "abilities": "<p><strong>Necrodermicon</strong>: …</p>",
      "leader": "<p>This model can lead the following additional unit: …</p>",
      "keywords": { "add": [], "remove": [] },   // reserved; workbook-sourced, see §10 Q4
      "modelStats": []                            // reserved; same shape as catalog tiers
    }
  ]
}
```

**Entry state** (`public/js/list-builder.js`, per selected unit):

```jsonc
"keyChar": { "path-of-study": ["technomancer"] }        // scope: unit
"keyChar": { "path-of-study": { "0": ["technomancer"] } } // scope: model (mirrors entry.gifts)
```

Deliberately an **array** even for `select.max === 1`, so the Asuryani multi-select and a
future multi-select inline case use one code path — and so it mirrors `entry.gifts`
exactly, which the clamp/serialise logic already knows how to handle.

---

## 5. Converter work (`scripts/convert_options.py`)

### 5.1 Stop dropping unrecognised H6 sections *(prerequisite, valuable on its own)*

Change the level-6 branch so an unrecognised heading opens a **candidate** section that
buffers its paragraphs (and their H7/H8 structure) instead of discarding them. At
`close_unit()` the candidate is resolved:

- intro matches a §3.1/§3.2 template → key-characteristic section;
- otherwise → **hard error** naming faction / unit / heading.

That error immediately surfaces the four Necron `Abilities` typos and the GSC
`Ridgehauler Trailers` block. To keep the build green on prose-only sections that are
legitimately free-form, add a small allow-list of prose-only headings (`Abilities` →
alias to `specialAbilities`; a generic "unknown but prose-only" escape needs a decision,
§10 Q5).

### 5.2 Preserve H7/H8 structure

Replace the `if lvl in (7, 8): cur_sec = None` discard with structural markers pushed
into the section buffer, so `parse_section` can be handed each H8 `Wargear:` block
verbatim.

### 5.3 New parser: `parse_key_characteristic(label, paras, …)`

- Match the intro; derive `select`, `scope`, `source`.
- For each H7: create a profile; run the **existing** `parse_section()` over its
  `Wargear:` paragraphs with a section key of `<sectionId>-<profileId>` so clause ids are
  unique across profiles; render `Abilities:` / `Leader:` with the existing
  `_render_prose_only()`.
- For `source: "catalog"`: resolve the label against
  `src/data/upgrade-catalogs/{slug}.json`; unresolved → hard error.
- Emit `upgradeAllowance` from the sentence when catalog-backed (see §10 Q3).

### 5.4 Small parser fix: strip a leading definite article

`ART_RE` (`scripts/convert_options.py:353`) strips `a` / `an` / `1` but not `the`, so
"…is equipped with **the** Void Dragon's Spear" and "…and **the** Nightbringer's Scythe"
will not resolve. Extend it to `the`, retrying the unstripped string on failure so an
item legitimately beginning with "The" still resolves. Alternative: edit the prose (§8) —
but the parser fix is generic and prevents recurrence.

---

## 6. Engine work (`public/js/list-builder.js`)

**The key insight: one chokepoint does almost all of it.** `clauses(u)`
(`public/js/list-builder.js:74`) flattens `sections[].clauses` and is the *sole* source
of clauses for pricing, caps, controls, availability, suppression, relics, sub-selections
and every clamp. Teaching it to also yield the **active** profile's clauses makes the
entire existing machinery work on key characteristics with no further changes:

```js
function clauses(u, entry) {
  // …existing section walk…
  // + for each keyCharacteristic section, the clauses of the selected profile(s) only
}
```

`clauses()` is currently called with `(u)` alone from ~20 sites; it needs the entry in
scope. Two ways: thread `entry` through (explicit, ~20 call sites), or resolve the
"current entry" from module state. **Recommend threading it** — the existing signature
pattern (`optionCap(entry, u, cl, ref)`) already puts entry first, and a hidden global
would break `calcTotalPoints()`, which iterates all entries.

Then, additionally:

| Function | Change |
|---|---|
| `selectKeyChar(entryId, sectionId, profileId)` | **new** — toggle/set, honouring `select.min/max`; mirrors `toggleGift` |
| `_clampKeyChar(e, u)` | **new** — drop selections for removed sections/profiles; **clear `entry.sel` for the de-selected profile's clause ids** (they can no longer be found by `findClause`) |
| every `_clamp*` caller (`setModelTypeCount`, `setTier`, …) | add `_clampKeyChar` alongside `_clampGifts` |
| `calcUnitPoints` | no change for clause-priced profiles (falls out of `clauses()`); **add** an explicit `profile.points` adder when authored |
| `resolvedStats` / `resolvedKeywords` | accept profile `modelStats` / `keywords` through the existing `_applyStatRows` / `_kwAddRemove` path used by gift tiers (reserved capability, §10 Q4) |
| `unitIssues(entry)` | **new** violation when `select.min` is unmet ("Mantic: no Path of Study selected") |
| `addUnit` | pre-select the first profile when `select.min >= 1`, so a new unit is never invalid on drop |
| `loadState` | tolerate absent `keyChar` (old sessions) |

### Catalog-backed sections

These reuse the **existing gifts path** unchanged — `giftTier`, `giftsCost`,
`_clampGifts`, `upgradeAllowance`. The new section only supplies the label, prose and cap
for rendering. No new pricing code.

---

## 7. UI work (`public/js/list-builder-ui.js`)

- **New `renderKeyCharacteristics(entry, u)`**, called from `renderOptions()`
  (`public/js/list-builder-ui.js:225`) between `renderFixedZone` and `renderSections` —
  the choice determines the wargear below it, so it must read first.
- Each section renders as a `<details open>` block titled with its `label`:
  - intro prose;
  - the option list — **radio** when `select.max === 1`, **checkbox** when > 1
    (consistent with `controlType` in §7.1 of the grammar doc);
  - each option shows its **points delta** (sum of its clauses, or its flat `points`);
  - the **selected** profile expands inline to show its granted-wargear clauses via the
    existing `renderClause()` (so the Kroot Shaper's nested picks are live controls) plus
    its `Abilities` / `Leader` prose.
- Catalog-backed sections route to the existing `renderAllowance()` under this heading
  instead of the current unlabelled gifts block — which also fixes the 14 Chaos units
  whose `Gifts of Chaos` explanation is currently dropped.
- The event delegation block gains `data-keychar` handling next to `data-gift`.
- CSS: reuse `.lb-tier-opt` (the composition-tier radio list) — visually this *is* the
  same control. Add to both `src/styles/global.css` **and** `public/styles/global.css`
  (hand-synced pair) or, better, to `public/styles/list-builder.css`.

---

## 8. Source re-authoring worklist

All edits are to `Alt-Hammer 40,000 1st Edition - Faction Rules Index.docx`.

| Unit | Edit |
|---|---|
| **Mantic** | Intro → `This model must select 1 of the following Paths of Study, which determines its Wargear and some Abilities as described under each Path.` (only "Each Mantic unit" → "This model"). Structure already conformant. |
| **Shard of Transcendent C'Tan** | Intro → `This model must select 1 of the following Harnessed Gods, …`. Drop the definite article in two wargear lines (or take the §5.4 parser fix instead). |
| **Gorkanot / Morkanot** | **Move** the type choice out of `Standard Wargear` into its own H6 (e.g. `Kanot Pattern`), intro `This model must select 1 of the following patterns, which determines its Wargear.`, and wrap each H7's item list in an `H8 Wargear:` block. The unit then has no `Standard Wargear` section, which is fine (Mantic and C'Tan have none either). |
| **Kroot Shaper** | Intro → `This model must select 1 of the following Shaper's Paths, …`. **Replace the bare `1 of the following:` lead-ins** inside each `Wargear:` block with a §3 template: `This model must be equipped with 1 of the following:`. This is the only genuine grammar violation in the set. |
| **Autarch / Annatharch** | Replace the wargear-options phrasing (`can be equipped with up to 4 of the following` + `wargear-ref` bullets that resolve to nothing) with the §3.2 one-liner: `This model can select up to 4 of the following Paths of the Aspect Shrines, …`, and delete the bullet list — the catalog already defines the options. Heading must equal the workbook Category `Paths of the Aspect Shrines`. |
| **Necrons ×4** | `Abilities` → `Special Abilities` (Hexmark Destroyer, Canoptek Scarabs / Spyder / Reanimator). Unrelated to this feature; found by the same audit. |

**Workbook edits** (`… Wargear Upgrades and Detachment Traits by Faction.xlsx`): the
Asuryani catalog rows currently carry keywords for only 3 of 8 Paths (Asurmen, Karandras,
Maugan Ra) and none of the ability text. Paths whose effect is purely in-game (Fuegan,
Lhykis, …) legitimately have no mechanical row — but the **ability prose** has no home
today (§10 Q4).

---

## 9. Phasing & verification

| Phase | Content | Gate |
|---|---|---|
| **0** | §5.1 + §5.2 converter plumbing; unrecognised H6 becomes an error; `Abilities` alias | `run_all.py` green; 26 dropped sections reduced to a named worklist |
| **1** | §5.3 inline parser + §6 engine `clauses()` threading + `_clampKeyChar` | Mantic, C'Tan, Gorkanot, Kroot Shaper carry profiles and correct points headlessly |
| **2** | §7 UI block, radio/checkbox, inline clause rendering | Manual pass in the browser (**rebuild first** — the dev server serves prebuilt `dist/`) |
| **3** | §3.2 catalog-backed sections; Autarch/Annatharch; re-home the 14 Chaos `Gifts of Chaos` sections under the same block | Chaos points unchanged (regression), Asuryani Paths priced at 10 each |
| **4** | Docs: `wargear-grammar.md` gains §1.1 rows, a §3.8 template table and a §7.6 runtime section | — |

**Headless verification** follows the pattern used for gifts and banded wargear: a
Node script loading `public/data/units/*.json` + `public/js/list-builder.js`, asserting
per-profile points totals against the table in §1.4, min-selection violations, clause
clamping on profile switch, and Chaos-unchanged regression.

---

## 10. Decisions

**Q1 — Points model. → DECIDED: bill on top of `basePoints`**, exactly as Standard Wargear
is today. The §1.4 spreads stand (Mantic 110–155, C'Tan 400–520, Kroot Shaper 56–70).
Existing `basePoints` in the Unit Data workbook are *exclusive* of profile wargear and
need no revision.

**Q2 — Per-model scope. → Carry the `scope` field in the schema, implement `unit` only.**
Every current instance is a single-model Character. `scope: "model"` (each model of a
squad picks its own profile, mirroring gift `scope: "model"`) is reserved in the schema
and implemented when a real unit needs it — no per-model UI designed against zero cases.

**Q3 — Allowance source for catalog-backed sections. → Workbook column stays
authoritative; parse the prose as a cross-check and warn on disagreement.** The
`Upgrade Allowance` column is already built and is the only way to express `champion`
scope, which the Chaos units need. Same policy as the prose-vs-workbook points drift rule.

**Q4 — Per-option ability text for catalog-backed options. → DECIDED: harvest from the
docx.** Pull the faction-level `### Paths of the Aspect Shrines` prose into the catalog
JSON the way `convert_detachment_traits.py` harvests trait `effects[]`. No workbook
column added; prose stays authored in one place.

**Q5 — Unrecognised H6 policy. → DECIDED: hard error**, consistent with the parser's
golden rule. Future free-form prose headings must be added to the allow-list or the build
fails — that strictness is precisely what would have caught these five and the four
Necron `Abilities` typos.

**Q6 — Re-authoring. → DECIDED: exact edit list produced for you to apply in Word** (§8).
No parser tolerance for the three existing intro phrasings — tolerance there is the
guessing `wargear-grammar.md` forbids. The Kroot Shaper `1 of the following:` fix is
required regardless.

---

## 11. Deliberately out of scope

- **Leader-list expansion enforcement.** The builder does not model leader attachment at
  all (`leader` sections are prose-only). A Path's "can lead the following additional
  unit" is captured and displayed, not enforced.
- **In-battle selections.** "Select 1 of the following abilities to be in effect this
  Battle Round" (Astartes *Expert Warcraft*, Ork *Nob Taktiks*, AdMech *Doctrina
  Imperatives*, C'Tan *Untethered God*) are per-round game choices, not list-building
  choices. They stay prose.
- **`Asuryani Psychic Powers`** (Farseer, Warlocks). A separate selection feature with its
  own pool and casting rules; surfaced by the §1.3 audit, planned separately.
- **`Ridgehauler Trailers`** (GSC Land Train). Plain prose; needs only §5.1 so it stops
  being dropped.

---

## 12. What shipped (2026-08-07)

All five instances are live, plus the 16 catalog-backed sections that were previously
dropped. Verified by `_t-key-characteristics.cjs` (33 headless assertions against the real
data + engine) and a Playwright pass over the real page (20 checks, no JS errors).

### Points now produced

| Unit | Before | After |
|---|---|---|
| Mantic | 85 flat | **110 / 120 / 135 / 155** by Path |
| Shard of Transcendent C'Tan | 400 flat, **no weapons** | **400 / 450 / 475 / 520** by God |
| Gorkanot / Morkanot | 200 flat, **no weapons** | **381** (Morkanot) / **396** (Gorkanot) |
| Kroot Shaper | 50 flat | **56–77** by Path and its picks |
| Autarch / Annatharch | 112 / 92 flat | **+10 per Path**, capped 4 / 2 |

### Deviations from the plan, and why

- **§5.4 (leading `the` in `ART_RE`) not needed.** The author re-authored the C'Tan and
  Gorkanaut wargear as bare item lines, which resolve cleanly. Left alone rather than
  widening the parser for a case that no longer exists.
- **Catalog sections keyed off the H6 heading matching the catalog Category**, not off the
  §3.2 intro template. Chaos states its allowance in free prose across 14 units; keying on
  the heading made all of them work with no re-authoring, and keeps the workbook column
  authoritative as decided in Q3.
- **`Abilities` aliased to `specialAbilities`** in `H6_MAP`, and `Special Abilities:`
  accepted alongside `Abilities:` at H8 — the source uses both, and neither is a typo.
- **New section key `additionalRules`** for legitimately free-form prose headings
  (`Ridgehauler Trailers`, `Asuryani Psychic Powers`), gated by an explicit allow-list so
  rule 4 (hard error) still catches typos.

### Fixed along the way (pre-existing, surfaced by this work)

- **`ah_converter_utils.py` now forces UTF-8 on stdout/stderr.** A single `⚠` in
  `convert_upgrades`' points-drift report raised `UnicodeEncodeError` on the cp1252 Windows
  console and **aborted the run part-way**, silently costing every faction later in sheet
  order. Asuryani was one of them.
- **`syncGifts` refreshed nothing for a unit rendering its catalog under its own H6** —
  a regression introduced here, caught in the browser pass and fixed by giving the section
  a `.lb-kc-catalog` refresh target.
- **Double-escaped gift meta** (`Scout 7&amp;quot;`) — `esc()` was applied twice.
- **"All <type> … (per model)"** now reads "Choose up to N" on a single-model character.

### Still open (author's data, unrelated to this feature)

- 3 hard errors in `convert_options`: `Dozer Blade Mout` (typo, Leman Russ), a stray
  `Aeldari` line (Goliath Truck), `Broader Xenos Factions` (Tantalus). The step writes its
  files before raising, so the data is complete — but the pipeline reports FAILED until
  they are fixed.
- The workbook ID for *Path of Fuegan* is `path-of-feugan`. Harmless (ids are internal, the
  prose join is by name) but worth correcting.
