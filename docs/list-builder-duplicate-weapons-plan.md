# List Builder — Adding Duplicate Melee Weapons: Implementation Plan

**Phases 1 and 2: implemented — 2026-09-04.** O5 is closed (the pipeline has been run; the rule now lives in
`making-attacks.mdx`). Phase 3 (tooltips, Markdown roster line) remains outstanding.

*Prepared 2026-09-04 for review/approval.*
*Revised 2026-09-04: open items O1–O5 resolved (see **Resolved decisions**). The rule has been rewritten and
relocated in the Core Rules source, which settles D2 from the rule's own words and adds an Extra Attacks
interaction the first draft did not cover.*
*Companions: `docs/list-builder-rules-depth-plan.md` (R1–R5 effect layers), `docs/list-builder-phase3-plan.md` (roster/export), `docs/wargear-grammar.md`.*

## The rule

Core Rules → **Making Attacks → Melee Attacks → Adding Duplicate Melee Weapons to Models** (Heading 4,
sitting between the Fight sequence and *Engaging Additional Units Over the Course of a Fight*). This is the
revised text now in the source `.docx`:

> Some models may allow players to select more than 1x of the same Melee weapon for that model (or models in
> multi-model units). In these instances, players add the points cost for each Melee weapon, but treat all
> Melee attacks made by those weapons as a single weapon. Further, models who are equipped with duplicate
> Melee weapons in this manner modify attacks made with those weapons as follows:
> 1. For every 2x of the same Melee weapon, increase the Attacks characteristic of the bearer by 1 and gain
>    the Sustained Hits 1 ability, or increase an existing Sustained Hits [X] ability by 1.
> 2. For every 4x … by 2 … Sustained Hits 2 …
> 3. For every 6x … by 3 … Sustained Hits 3 …

The three bullets are one function stated three times. With `n` copies of one weapon on one model:

```
k = floor(n / 2)

bearer Attacks  += k
Sustained Hits  += k       (gain Sustained Hits k when the weapon has none)
```

The floor is confirmed (O1): 3 copies confer nothing beyond what 2 confer, 5 nothing beyond 4.

Two phrases in the revised text do real work for this plan, and neither was in the original:

- **"modify attacks made with those weapons"** — the effect is scoped to the duplicated weapon. This is now
  the rule's own wording rather than an interpretation, and it settles D2.
- **"(or models in multi-model units)"** — the rule explicitly reaches squads, so the multi-model half of the
  work is in scope rather than an edge case.

## Decisions taken

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Melee weapons only.** Ranged duplicates, and options bundling `Nx` of a ranged weapon, are out of scope. | Surface is 31 units rather than ~120. Now matches the source text, which reads "the same Melee weapon" throughout. |
| D2 | **The effect lands on the merged weapon, not the model statline.** | `resolvedStats` is never touched; no printed statline moves. Backed by the rule's "modify attacks made with those weapons" and by the Fight sequence — see below. |
| D3 | **On multi-model units the player assigns the pairing.** | New per-unit state, a stepper in the unit panel, one new share-codec key. Defaults to the minimum the arrangement forces (O4). |

### Why D2 is now settled rather than chosen

The Fight sequence in the same section states how a model spends its Attacks:

> **Select Melee Weapon:** Models can allocate the number of attacks they have as determined by their Attacks
> Characteristic to 1 Melee weapon they are equipped with (using that weapon's profile to make those
> attacks), as well as make Melee attacks with any weapons they are equipped with that have the Extra Attacks
> ability.

A model pours its whole Attacks characteristic into **one** chosen melee weapon. So raising the model's
printed A would raise the attacks of whichever single weapon the player picked — including a weapon that has
nothing to do with the duplicate. A Hive Tyrant with 2× Scything Talons and a Bone Reaper would have swung
the Bone Reaper harder. Scoping the bump to the merged weapon is the only implementation that matches both
sentences.

---

## What the data actually contains

Measured across all 12 faction files (387 units), counting only weapons in a `Melee Weapons` section, with
per-clause caps and slot pooling applied — a weapon offered as several mutually-exclusive options in one
clause counts once, and two clauses sharing a slot pool cannot both land on the same model.

**31 units across 11 factions can put ≥2 of the same melee weapon on one model.**

### Single-model units — count is exact, no ambiguity (13)

| Faction | Unit | Duplicable melee weapons | Max copies |
| --- | --- | --- | --- |
| Adeptus Astartes | Contemptor Dreadnought | Dreadnought Power Fist, Dreadnought Power Talons | 2 |
| Adeptus Astartes | Redemptor Dreadnought | Dreadnought Power Fist, Dreadnought Power Talons | 2 |
| Chaos Undivided | Lord | Chainblade, Power Sword, Power Maul, Power Fist, Chainfist, Lightning Claw | 2 |
| Chaos Undivided | Champion | Chainblade, Power Sword, Power Maul, Power Fist, Chainfist, Lightning Claw | 2 |
| Chaos Undivided | Cultist Demagogue | Chainblade, Power Sword, Power Maul, Power Fist | 2 |
| Chaos Undivided | Defiler | Dreadnought Power Claw, Power Scourge | 2 |
| Chaos Undivided | Hellbrute | Dreadnought Power Claw | 2 |
| Chaos Undivided | Despoiler | Dreadnought Power Claw, Dreadnought Chainblade, Dreadnought Crusher Drill, Power Scourge | 2 |
| Orks | Deff Dred | Killa Klaw | **4** |
| Orks | Gorkanot / Morkanot | Killa Klaw | 2 |
| The T'au Empire | Kroot Shaper | Shaper's Blade | 2 |
| Tyranids | Hive Tyrant | Scything Talons, Rending Claws, Bone Reaper | 2 |
| Tyranids | Tyranid Prime | Scything Talons, Rending Claws, Bone Reaper | 2 |

### Multi-model units — pairing needs the player's input (18)

| Faction | Unit | Max models | Duplicable melee weapons | Max copies |
| --- | --- | --- | --- | --- |
| Adeptus Astartes | Intercessors | 5 | Chainsword | 2 |
| Adeptus Mechanicus | Kastellan Robots | 4 | Power Fist | 2 |
| Astra Militarum | Militarum Tempestus Scions | 11 | Combat Knife | 2 |
| Asuryani | Howling Banshees | 10 | Star Blade | 2 |
| Asuryani | Striking Scorpions | 10 | Chainsword | 2 |
| Chaos Undivided | Cultists | 25 | Improvised Melee Weapon, Rending Claws | 2 |
| Chaos Undivided | Legionaries | 5 | Chainblade, Chainglaive | 2 |
| Chaos Undivided | Chosen | 5 | Lightning Claw | 2 |
| Chaos Undivided | War Dogs | 2 | Dreadnought Power Claw, Dreadnought Chainblade | 2 |
| Drukhari | Wracks | 15 | Masochir Blade | 2 |
| Drukhari | Talos | 2 | Chain Flails, Macro-Scalpel, Ichor Injectors | 2 |
| Genestealer Cults | Acolytes | 15 | Metamorph Mutations | 2 |
| Necrons | Lychguard | 5 | Voidblade | 2 |
| Necrons | Triarch Praetorians | 10 | Hyperphase Sword, Voidblade | 2 |
| Orks | Kommandos | 10 | Choppa | 2 † |
| Tyranids | Warriors | 3 | Scything Talons, Rending Claws, Bone Reaper | 2 |
| Tyranids | Guardians | 3 | Rending Claws | 2 |
| Tyranids | Carnifexes | 2 | Scything Talons, Crusher Claws | 2 |

**30 of the 31 cap at 2 copies per model. Only Deff Dred (4) goes higher, and it is a single model.**

† *Corrected after Phase 1.* The survey above is an upper-bound scan, and it credited Kommandos with 3 Choppas
by summing a fixed grant against a replace clause that displaces it. Driven through the engine, no squad model
in the data can hold more than 2 of one melee weapon. That matters for Phase 2: it deletes the per-copy-count
tier machinery from the design entirely — see *Phasing*.

### Two facts that shrink the risk

- **No melee option carries a baked-in `Nx` quantity.** 94 options in the data bundle a weapon at qty ≥ 2
  (Predator's 2× Heavy Bolter, Seraphim's 2× Bolt Pistol, Ghost Ark's 5× Twin-linked Gauss Flayer) —
  every one of them is a Ranged weapon, so D1 excludes all of them. Nothing compulsory is swept in.
- **No melee duplicate arises inside a sub-selection.** One sub-selection group in the data permits the same
  option twice (`armoured-container` group-1, Genestealer Cults); both its options are Ranged. The clause
  walk is therefore complete coverage for melee, and no new traversal of `subSelections` is needed.

### Extra Attacks — the most common configuration in the surface

Four of the duplicable melee weapons carry **Extra Attacks**, and between them they account for six of the
31 units — including every Tyranid entry, which is the case the request opened with:

| Weapon | Attacks | Other keywords | Units |
| --- | --- | --- | --- |
| Scything Talons | `A+3` *(Flury)* / `A-2` *(Stab)* | Heavy, Lance, Lethal Hits | Hive Tyrant, Tyranid Prime, Warriors, Carnifexes |
| Rending Claws | `A` | Devastating Wounds, Sustained Hits 1 | Hive Tyrant, Tyranid Prime, Warriors, Guardians, Cultists |
| Ichor Injectors | `A-2` | Anti-INFANTRY 3+, Poison 1 | Talos |
| Metamorph Mutations | `A+1` | Poison 1, Sustained Hits D3 | Acolytes |

An Extra Attacks weapon is swung *in addition to* the weapon the model allocated its Attacks to, but its own
Attacks value is still bearer-relative, so nothing special is needed — the merge applies to the expression
exactly as it does anywhere else. A Hive Tyrant with 2× Scything Talons and a Bone Reaper resolves to:

| Weapon | Attacks | Keywords |
| --- | --- | --- |
| Scything Talons ×2 *(Flury)* | `A+4` | Extra Attacks, Heavy, Lance, Lethal Hits, **Sustained Hits 1** |
| Scything Talons ×2 *(Stab)* | `A-1` | Extra Attacks, Heavy, Lance, Lethal Hits, **Sustained Hits 1** |
| Bone Reaper | `A` — unchanged | *(as printed)* |

This is the configuration that makes D2 concrete: under a model-statline implementation the Bone Reaper would
have gained an attack it is not entitled to.

Note also that Rending Claws and Metamorph Mutations already carry a Sustained Hits value, so a pairing
increments rather than grants — `Sustained Hits 1` → `2`, and `Sustained Hits D3` → `D3+1`.

### The Attacks expressions the transform must handle

Every melee `attacks` value in the data, by frequency:

| Form | Example weapons | Transform for +k |
| --- | --- | --- |
| `A` (74) | Bone Reaper, Choppa, Power Sword, Star Blade | → `A+k` |
| `A +2` / `A+1` / `A -2` / `A-2` (61 across spacings) | Chainsword, Cult Blade, Power Fist, Chainfist | offset += k, source spacing preserved |
| `A x2` / `Ax2` (14) | Dreadnought Power Fist *(Sweep)*, Killa Klaw *(Slash)*, Agoniser | → `(A+k) x2` |
| `1`, `10` (10) | Dreadnought Crusher Drill, Dreadnought Power Claw *(Crush)* | value += k — confirmed at O2 |
| `D3`, `D6`, `D3+1` (8) | Hunting Lance, Goad Lance | trailing offset += k |

The data is inconsistent about spacing (`A +2` vs `A+1`); the transform matches both and writes back in the
form it found, exactly as `_applyDelta` in `weapon-mods.js` already does for `S +3`.

---

## Architecture

### Why not the existing stat-modifier machinery

The obvious route is the R1/R4 path — author the effect as a `mechanics.rows[]` entry and let
`resolvedStats` apply an Attacks delta. D2 rules that out, and the data agrees:

- The effect is **per weapon**, not per model — now stated by the rule itself, and demonstrated by the
  Hive Tyrant case above. A model-domain row cannot express it.
- **Sustained Hits is a weapon keyword.** Half the rule has no home on a model statline.
- The workbook that feeds `mechanics.rows[]` is the authoring surface for *wargear*. This is a **core rule**
  with no wargear item behind it, so it belongs in the builder's own resolution layer, not in per-faction
  source data. `weapon-mods.js` keeps its stated contract — "a new weapon modifier needs source data only".

So: a new engine layer, sitting beside R1–R5, that resolves weapon profiles rather than model statlines.

### Layer 0 — detection and counting (`public/js/list-builder.js`)

New section **"Duplicate melee weapons (R6)"**, placed after the weapon-availability block.

The count comes from the existing `_walkUnit` traversal — the file's invariant is that points and loadout
read one walk, and the duplicate count must not become a third, divergent reading of the selections.
`_emitOption` already stamps every record with `src = clauseId + '::' + optRef`; it gains two more extras:

```js
{ src, clauseId: cl.id, perModelCap: /* max copies one model may take from this clause */ }
```

`perModelCap` is derived once per clause: `pick.max` for `who:each` / `who:count` / `ratio` (1 when absent or
`distinct`), 1 for `who:unit`, and the option's own `qty` for `fixed` — the same arithmetic the survey above
used. Records are additive, so `_recKey`, `_mergeRecords` and every existing consumer are untouched.

Detection runs on the records **after `_splitUpgrades`**, which is what makes O3 fall out for free: a
Relic-marked copy has already moved onto its own line with its own `mods`, so it stops pairing with a plain
copy, while **two** Relic-marked copies land on one line together and pair with each other exactly as O3
requires. One change this needs: `_splitUpgrades` currently builds its split line with `_rec(...)` carrying
only `ref` and `modRefs`, so it must also copy `clauseId` and `perModelCap` from the base line, or the split
identity reaches the bounds maths with no sources.

```
duplicateGroups(entry, mt) → [{
  key,            // modelType|weaponName|mods — the assignment and display key
  name, ref, mods,
  sources: [{ clauseId, instances aᵢ, perModelCap capᵢ }],
  I,              // total instances of this weapon on models of this type
  M,              // models of this type
  C,              // Σ capᵢ — max copies one model can hold
  lo, hi,         // bounds on the number of models holding ≥2 copies
  copies,         // copies each duplicating model holds
  models          // how many models are duplicating (assigned or forced)
}]
```

**Single-model units (M = 1)** — `copies = I`, `models = 1`, exact. No state, no control. This is the
Contemptor / Deff Dred / Hive Tyrant path and covers 13 of the 31 units.

**Multi-model units (M > 1)** — the list records how many models took an option, never which, so the number
of models holding two copies is bounded, not known:

```
lo = max(0, ceil((I − M) / (C − 1)))                  // pigeonhole: the extras must pile up somewhere
hi = max t ≤ M such that Σᵢ min(aᵢ, t·capᵢ) ≥ 2t      // Hall-type feasibility over the clauses
```

Worked against the real cases:

| Unit | Configuration | I | M | lo | hi | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Legionaries ×5 | 5 Chainblades from **one** clause, `pick.max 1` | 5 | 5 | 0 | **0** | no duplicate is possible — nothing shown at all |
| Warriors ×6 | 6 Talons in clause 1, 3 in clause 2 | 9 | 6 | 3 | 3 | **forced** — 3 models paired, no control shown |
| Warriors ×6 | 3 Talons in clause 1, 2 in clause 2 | 5 | 6 | 0 | 2 | ambiguous — stepper 0–2, defaults to 0 |
| Talos ×2 | 2 Chain Flails from one `pick.max 2` clause | 2 | 2 | 0 | 1 | ambiguous — stepper 0–1, defaults to 0 |
| Deff Dred | 4 Killa Klaws | 4 | 1 | 1 | 1 | forced — 1 model, 4 copies, k = 2 |

The first row is worth dwelling on, because it is the case O4 was concerned about. A squad that spreads one
melee weapon across its models, one each, draws all its instances from a single clause with `perModelCap 1`,
so `hi = 0` — the feasibility test proves no model can hold two, and the builder shows nothing. The stepper
only ever appears when two clauses (or one `pick.max ≥ 2` clause) could genuinely stack on one model.

**Assignment state.** `entry.dup = { "<key>": <models holding ≥2 copies> }`, and for the two units where
`C > 2`, `"<key>#<j>"` for models holding exactly *j* copies. **The default is `lo`** (O4) — the minimum the
arrangement forces, which is 0 whenever 0 is feasible. Only values that differ from that default are stored,
so a list that never touches the control adds nothing to its share link.

Clamp `_clampDup(e, u)` joins the existing `_reclamp` chain (beside `_clampGifts`, `_clampRelic`,
`_clampSubRelic`) and re-derives `[lo, hi]` after any model-count or selection change.

### Layer 1 — merged weapon resolution

`weaponProfiles(ref, modRefs, dup)` gains an optional duplicate multiplier and applies the merge *after*
`AH_WMOD.resolve` has finished, so Twin-linked and Relic surcharges tier against the un-merged weapon
exactly as they do today and pricing is provably unaffected:

```js
_applyDuplicate(profiles, k)   // per profile:
  attacks  ← bearer-relative bump, or +k on a fixed value (O2); unrecognised form → left alone and flagged
  keywords ← 'Sustained Hits N' → N+k | 'Sustained Hits D3' → 'D3+k' | else push 'Sustained Hits k'
```

A profile whose Attacks form isn't recognised keeps its printed value and is reported in the note as
"+k Attacks (apply manually)" rather than being silently mangled.

### Layer 2 — presentation

| Surface | Change |
| --- | --- |
| Builder unit panel | A `.lb-dup-note` under each model type's statline, in the visual grammar of the existing `.lb-partial-note`: *"1 model — 2× Dreadnought Power Fist merged: A +1, gain Sustained Hits 1"*. Where `lo < hi`, a stepper beside it: *"models pairing Scything Talons: [− 0 +] (0–2)"*. |
| Roster / export | The same note under `statTableHtml`, alongside the existing partial-cover footnotes, so the printed roster carries it. |
| Weapon appendix | The merged profile printed as its own row — *Dreadnought Power Fist (×2)* with A and Sustained Hits already resolved. The dedup key gains the multiplier, so a list holding both a single and a paired Power Fist prints both. |
| Loadout line | The existing `2x Dreadnought Power Fist` line gains a `dup` field so the Markdown roster can print `— merged: A +1, Sustained Hits 1` beneath it. |
| Keyword tooltips | The note emits `<span class="keyword" data-term="sustained-hits-2">`; `keyword-tooltips.js` already prefix-falls-back to `sustained-hits`, so every value resolves with no definition work. |

### Layer 3 — validation and points

**Nothing.** The rule charges full price for each weapon, which the builder already does — every duplicate
instance is a separate priced record today. No record's `points` field is written by any of the above, so
army totals cannot move. This is the plan's central safety property, and the harness asserts it directly.

---

## Files

| File | Change |
| --- | --- |
| `public/js/list-builder.js` | new R6 section (`_meleeWeapon`, `_dupSources`, `duplicateGroups`, `setDuplicateAssignment`, `_clampDup`); `clauseId` / `perModelCap` extras in `_emitOption` **and in `_splitUpgrades`**; `weaponProfiles` merge; `duplicates` on `unitLoadout`; `weaponAppendix` key; `toMarkdown` line; `exportState` / `hydrate` / `clampAll` carry `dup` |
| `public/js/list-builder-ui.js` | duplicate note + assignment stepper under each statline; delegated change handler |
| `public/js/list-export.js` | duplicate footnotes; merged rows in the weapon appendix |
| `public/js/list-share.js` | one new `UNIT` key — `dup: 'x'` |
| `public/styles/list-builder.css` | `.lb-dup-note`, `.lb-dup-assign` |
| `public/styles/list-export.css` | `.lx-dup-notes` + print rules |
| *generated rules MDX* | re-run `convert_rules.py` — see *Outstanding action* below |

No converter code changes, no unit-data changes, no faction-wargear changes.

## Phasing

**Phase 1 — engine + exact counts (13 units). ✅ Implemented 2026-09-04.** Detection, the merged-profile
transform, the builder note, the roster footnote, the weapon appendix. No new state, no new UI control, no
share-codec change. Ships the marquee cases: both Dreadnoughts, Deff Dred, Hellbrute, Despoiler, Defiler,
Hive Tyrant, Tyranid Prime. Forced multi-model cases (`lo === hi`) came along free, since they need no state
— Warriors, Carnifexes, Talos and Intercessors already resolve where their arrangement forces the pairing.

Two implementation notes worth carrying forward:

- **`lo` is the Phase 1 behaviour, not a placeholder.** Because O4 sets the default to `lo`, "no control yet"
  and "the control at its default" are the same thing. Phase 2 adds the stepper without changing any answer
  the builder gives today.
- **The bounds run at unit level, not per model type.** `M = totalModels(entry)`, which is exact for the
  single-model units and never over-claims on a squad — a per-type bound could only force *more*, so the
  unit-level reading under-reports at worst. Phase 2 should revisit this when it starts attributing pairs to
  specific model types.

**Phase 2 — player assignment. ✅ Implemented 2026-09-04.** The stepper, `entry.dup`, the share key `x`, and
`_clampDup` at the end of the `_reclamp` cascade. Scoped by measurement after Phase 1 shipped, which changed
two things the draft assumed:

- **15 (unit × weapon) pairs are genuinely ambiguous**, not 18 units wholesale. The other 33 duplicable pairs
  in those units are either forced (`lo === hi`, already resolving) or impossible (`hi = 0`), so Phase 1
  already handles them. The ambiguous set: Kastellan Robots (Power Fist), Tempestus Scions (Combat Knife),
  War Dogs (Power Claw, Chainblade), Talos (Chain Flails, Macro-Scalpel, Ichor Injectors), Acolytes
  (Metamorph Mutations), Lychguard (Voidblade), Triarch Praetorians (Hyperphase Sword, Voidblade), Warriors
  (Scything Talons, Rending Claws), Carnifexes (Scything Talons, Crusher Claws).
- **No weapon can reach 3+ copies on a squad model.** The Kommandos ×3 in the original survey was an artifact
  of the upper-bound scan; driven through the engine it never materialises. **This deletes the per-copy-count
  tier machinery from the design**: `entry.dup` is just `{ "<key>": <models> }`, with no `"<key>#<j>"` variant
  and no stepper-per-tier. Every duplicating model on a squad holds exactly 2.
- It is a **stepper, not a toggle**. Ranges reach 0–7 (Acolytes ×15 with 7+7 Metamorph Mutations), 0–5
  (Triarch Praetorians ×10), 0–2 (Kastellan Robots, Lychguard). Most of the rest are 0–1.

**Per-model-type bounds — done.** Phase 1 used `M = totalModels(entry)`, which on a two-type unit counts
models that cannot hold the weapon at all. Five duplicate-capable units have two types (Tempestus Scions with
its Sentry Turret, Howling Banshees and Striking Scorpions with an Exarch, Cultists with a Torment, Kommandos
with a Nob), and one of them — Scions / Combat Knife — is in the ambiguous set. The bounds now use the named
type's count whenever *every* clause feeding a weapon names the same type, falling back to the whole unit
otherwise. A Sentry Turret is a model in a Scion squad, but not one that can hold a Combat Knife.

**How the control behaves.** Where the arrangement forces the answer, the builder states it and shows no
control. Where it leaves a choice, a stepper appears — **and it appears at zero**, muted, phrased as what
pairing *would* give. An invisible control on a squad that could pair its weapons would leave the rule
undiscoverable for exactly the units Phase 2 exists to serve. Assigning a value un-mutes the row; the roster
and the weapon appendix pick it up from there. `entry.dup` stores only values that differ from `lo`, so a list
that never touches the control adds nothing to its share link — proven by the byte-comparison below.

**Phase 3 — polish.** `data-dup` on weapon refs so hover tooltips show the merged profile; the Markdown
roster line.

## Verification — Phase 2 results

Re-run after the content pipeline regenerated every unit JSON, so these are measured against current data.
Two baselines: the **pre-R6 engine** (reconstructed by reversing each Phase 1 edit) and the **Phase 1 engine**
(snapshotted before Phase 2 began). Phase 2 with no assignment made must be indistinguishable from Phase 1 —
because O4 sets the default to `lo`, "no control yet" and "the control at its default" are the same state.

| Check | vs pre-R6 | vs Phase 1 |
| --- | --- | --- |
| Units priced, all 12 factions | 387 | 387 |
| Points drift | **0** | **0** |
| Statline drift | **0** | **0** |
| Share-state drift (`exportState`, byte-compared) | **0** | **0** |
| Errors | **0** | **0** |
| Units where the rule fires at max loadout | 8 | 8 — identical set |

Phase 2 suite: **21/21**. Phase 1 suites re-run on the new data: targeted **20/20**, Relic identity **4/4**,
Acolytes dice-Sustained-Hits still resolving `D3 → D3+1` on all 15 models.

- Ambiguous squad (Warriors ×2, 1+1 Talons, range 0–1): defaults to 0, stores nothing, roster shows nothing.
- Assigning 1 stores `{"scything talons|":1}`, the roster gains *"1 of 2 models: 2× Scything Talons merged"*,
  and the appendix gains the merged profile. Points unchanged.
- Returning to the default deletes the key; a request of 99 clamps to `hi`.
- Removing a talon so the pairing becomes impossible **drops the stored assignment** via `_clampDup`.
- Share round-trip carries the assignment through `exportState` → `hydrate` with no notes.
- Both weapon profiles print when only some copies are paired (Warriors ×3 with 3+1 Talons: `[0, 2]`), and
  only the merged one when every copy is inside a pair (Warriors ×2 with 1+1: `[2]`).
- Tempestus Scions: bounds never exceed the pool they name, with the Sentry Turret excluded.

Browser end-to-end: the idle row renders muted with `−` disabled at 0 and reads *"0 of up to 1 model carries
2× Scything Talons — would give A +1, gain Sustained Hits 1"*; clicking `+` un-mutes it, disables `+` at `hi`,
and the roster and appendix follow. No page errors.

`_clampDup` returns immediately when `entry.dup` is absent, so the clamp cascade costs nothing on the
overwhelming majority of units that never use the control.

## Verification — Phase 1 results

No test suite is checked in, so this followed the `_lb-harness.cjs` / `_lb-baseline.cjs` pattern described in
`docs/list-builder-phase3-plan.md`. The pre-R6 engine was reconstructed by mechanically reversing each edit
(every reversal asserted, so a missed one cannot make the two agree by accident) and the two were run
side by side.

| Check | Result |
| --- | --- |
| Units priced by both engines, at a deterministic maximal loadout, all 12 factions | **387** |
| Points drift | **0** |
| Statline drift (`resolvedStats` + `resolvedKeywords`, every model type) | **0** |
| Share-state drift (`exportState`, byte-compared) | **0** |
| Errors / throws across `unitLoadout` and `weaponAppendix` | **0** |
| Targeted rule cases | **20 / 20** |
| Relic-identity cases (O3) | **4 / 4** |
| Files changed | 6 — 3 JS, 2 CSS, this plan. No converter, unit-data or wargear changes. |

The duplicate rule fires on 8 units under that maximal-loadout walk — which maximises in declaration order
and so lands the two arm clauses on different weapons for most of the 31. Every one that fired is melee, and
no ranged weapon was touched anywhere in the sweep:

```
adeptus-astartes / Intercessors (5 models): 2x Chainsword on 1 of 5   [the Sergeant — forced]
chaos-undivided  / Hellbrute  (1 model):    2x Dreadnought Power Claw
chaos-undivided  / Despoiler  (1 model):    2x Dreadnought Power Claw
drukhari         / Talos      (2 models):   2x Chain Flails on 2 of 2
tyranids         / Hive Tyrant (1 model):   2x Scything Talons
tyranids         / Tyranid Prime (1 model): 2x Scything Talons
tyranids         / Warriors   (3 models):   2x Scything Talons on 3 of 3
tyranids         / Carnifexes (2 models):   2x Scything Talons on 2 of 2
```

Browser end-to-end (Playwright against `astro dev`), Contemptor Dreadnought with 2× Dreadnought Power Fist:
the builder prints *"1 model: 2× Dreadnought Power Fist merged — A +1, gain Sustained Hits 1"* under the
statline, the model's printed **A stays 3 and is not marked modified**, the roster carries the same footnote,
and the weapon appendix prints *Dreadnought Power Fist ×2 merged* — Sweep `(A+1) x2`, Crush `A+1`, both with
Sustained Hits 1. Unit total 145 pts = 95 + 25 + 25, unchanged.

### The cases that were checked

1. **Points-drift baseline.** `calcUnitPoints` for every unit in all 12 factions at full loadout, before and
   after. This is the guard on the plan's central claim.
2. **Statline non-regression.** `resolvedStats` / `resolvedKeywords` unchanged for every unit, not just the 31.
3. **Targeted cases.**
   - Contemptor 2× Power Fist — `A x2` → `(A+1) x2`, `A` → `A+1`, gains Sustained Hits 1. ✅
   - Contemptor with a Power Fist *and* Power Talons — no group; different weapons do not merge. ✅
   - Deff Dred 4× Killa Klaw — k = 2, Sustained Hits 2; 3× and 2× both k = 1, per O1. ✅
   - Hive Tyrant 2× Scything Talons — `A+3`/`A-2` → `A+4`/`A-1`, both profiles gain Sustained Hits 1. ✅
   - Tyranid Prime 2× Rending Claws — an existing Sustained Hits 1 increments to 2 rather than being
     granted afresh. ✅
   - Hellbrute 2× Dreadnought Power Claw — Sweep `A x2` → `(A+1) x2` *and* Crush's fixed `A 1` → `2` (O2),
     the two profiles of one weapon moving together. ✅
   - **Relic identity (O3)** — on a Chaos Lord with 2× Chainblade: marking one copy Accursed breaks the
     pairing outright; marking both pairs them as *Chainblade (Accursed Weapon) ×2*. Note the upgrade is
     called **Accursed Weapon** on Chaos, not Relic Weapon — the test asserts against `relicModifier(u)`'s
     own name rather than the string "Relic". ✅
   - Acolytes ×15 with Metamorph Mutations in both melee clauses — forced on all 15 (`lo = hi = 15`), with
     the dice form of Sustained Hits taking the increment: `A+1` → `A+2`, `Sustained Hits D3` → `D3+1`. ✅
   - Intercessors — the Sergeant's second Chainsword is *forced* by the bounds (`lo = hi = 1`) and resolves
     with no control, while a squad spreading one chainsword per model yields `hi = 0` and renders nothing. ✅
4. **Share round-trip.** `exportState` is byte-identical to the pre-change engine for all 387 units, so
   Phase 1 cannot have changed any share link. ✅

The one case still out of reach is a genuinely **ambiguous** multi-model configuration — Warriors with 3
Talons in one clause and 2 in the other, say. Those resolve to `models = lo = 0` and render nothing, which is
the correct Phase 1 behaviour under O4; showing them is exactly what Phase 2's stepper is for.

## Resolved decisions

All five open items are closed. Recorded here because the engine encodes each one.

| # | Item | Resolution |
| --- | --- | --- |
| O1 | Odd counts | **Floor.** "The floor is 2, and the rule steps for every 2 weapons added. Instances of 3 or 5 weapons would not have modifiers beyond those conferred for 2 or 4 weapons, respectively." → `k = floor(n / 2)`. |
| O2 | Melee weapons with a fixed Attacks value | **Applies.** Dreadnought Crusher Drill (`A 1`) and Dreadnought Power Claw's Crush profile (`A 1`) take `+k` on the printed value. Affects Hellbrute, Defiler, Despoiler, War Dogs. |
| O3 | Weapon identity | **Identical weapons only.** A Twin-linked or Relic modifier on one of two copies breaks the pairing. Two Relic (or Accursed) copies on one model *do* pair with each other, and on a multi-model unit that combination drives the stepper like any other. Falls out of running detection after `_splitUpgrades`, given the metadata fix noted in Layer 0. |
| O4 | Default pairing on ambiguous units | **Start at `lo`, not `hi`** — reversing the draft's recommendation. Plenty of multi-model units take more than two of one melee weapon spread one per model, and the builder should not assume pairing. Note that the pure spread case never reaches the control at all: a single source with `perModelCap 1` yields `hi = 0`. |
| O5 | The rule text | **Done at source.** Rewritten as *Adding Duplicate Melee Weapons to Models* and moved to Making Attacks → Melee Attacks. The generated MDX has not caught up — see below. |

## Outstanding action

`src/content/rules/model-weapon-characteristics.mdx` still carries the old section at line 156 with the
pre-edit wording, and `making-attacks.mdx` does not yet contain the rule: **`convert_rules.py` has not been
re-run since the `.docx` was edited.** Until it is, the published rule on the site is both broader than D1 and
in the wrong section.

The converter rewrites all twelve rules MDX files from `Countermarch 40,000 1st Edition - Core Rules.docx`,
so it will also pick up any other in-flight edits to that document — worth a glance at the diff before
committing. Nothing links to the old `#adding-duplicate-weapons-to-models` anchor, so the move breaks no
references.

## Collateral considered and cleared

- **Army points** — untouched by construction; asserted by the baseline harness.
- **Model statlines** — untouched (D2). No existing `resolvedStats`, `partialModelEffects` or keyword output moves.
- **Existing share links** — the new key is additive and omitted at its default, so `v1` links keep working
  and most new links are byte-identical to what they would be today.
- **`_walkUnit` records** — two additive extras; `_recKey` / `_mergeRecords` unchanged. `_splitUpgrades` gains
  metadata propagation but no behaviour change.
- **`weapon-mods.js`** — not modified; its "source data only" contract holds.
- **Faction profile pages** — unaffected. The duplicate rule is a property of a *list selection*, not of a
  weapon, so the static weapon tables stay as printed.
