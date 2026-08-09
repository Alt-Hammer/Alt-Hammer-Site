# Wargear Grammar & Unit-Options Schema (Contract)

*Alt-Hammer 40,000 List Builder.*
*Companion to `docs/list-builder-redesign-plan.md` and `docs/list-builder-rules-depth-plan.md`.*
*Verified against `scripts/convert_options.py`, `public/js/list-builder.js` and `public/js/list-builder-ui.js`. Applies to **every** faction — the grammar is generic; nothing below is faction-special-cased.*

This document is the **contract** between three parties:

1. **The author** (Word doc) — writes Unit Composition / Standard Wargear / Armour Options / Wargear Options / Force Organization using *only* the sentence templates in §3. Anything else is a build error.
2. **The parser** (`convert_options.py`) — turns each template into a **clause** (§2) deterministically. No fuzzy matching, no silent drops.
3. **The engine + UI** — consume the canonical schema (§1–§2) to render prose, drive per-model controls, compute points, and validate.

> **Golden rule:** the parser never guesses. If a sentence doesn't match a template *exactly*, the build fails with `faction / unit / section / line / text`, and the Word doc is fixed. This turns silent data corruption into a finite, fixable worklist.

Not every input comes from prose: composition, statlines, keywords, squad-size constraints and upgrade-catalog entitlements are authored in the Excel workbooks (§6). §7 describes the runtime behaviour a given sentence produces, so authors can predict what a clause will look like in the builder. §8 lists what is deliberately *not* implemented.

---

## 1. Canonical unit record

The parser **extends** the Excel-derived `src/data/units/{slug}.json` in place with an `options` object per unit, and mirrors the whole file to `public/data/units/{slug}.json` (the copy the client fetches). The legacy `wargear/` and `unit-profiles/` files are redundant.

```jsonc
{
  "name": "Captain",
  "keywords": ["Imperium","Adeptus Astartes","Infantry","Character","Leader","Tacticus"],
  "epicHero": false,                 // derived from the keyword list
  "upgradeAllowance": [ … ],         // §6.1, from the Unit Data workbook (absent if none)

  "options": {
    "forceOrg": { … },               // null, or §5

    "composition": {                 // §4
      "mode": "range",               // "single" | "range" | "multi"  ("tiers" reserved, §8)
      "range": { "min": 1, "max": 1 },
      "modelTypes": [
        { "name": "Captain", "stats": {…}, "basePoints": 130, "keywords": [ … ] }
      ],
      "prose": "1 Captain"
    },

    "slots": ["armour","primary-ranged"],   // union of every slot named by a clause

    "sections": [                    // ordered; prose is generated FROM the source lines
      { "key": "unitComposition",  "prose": "…", "clauses": [] },
      { "key": "standardWargear",  "prose": "…", "clauses": [ /* §2 */ ], "notes": [] },
      { "key": "specialAbilities", "prose": "…", "clauses": [] },
      { "key": "armourOptions",    "prose": "…", "clauses": [ … ], "notes": [] },
      { "key": "wargearOptions",   "prose": "…", "clauses": [ … ], "notes": [] },
      { "key": "leader",           "prose": "…", "clauses": [] }
    ]
  }
}
```

**Section keys**: `unitComposition`, `standardWargear`, `specialAbilities`, `forceOrganization`, `armourOptions`, `wargearOptions`, `leader`, plus the free-form-heading pair `keyCharacteristic` (§3.8) and `additionalRules`. Only `standardWargear`, `armourOptions` and `wargearOptions` are **interactive** (they carry clauses and a `notes[]` array); `keyCharacteristic` carries its own selection structure; the rest are prose-only and render with bold/italic and bullet lists preserved.

`keyCharacteristic` and `additionalRules` are the only keys that may appear **more than once** on a unit, so consumers must key them by `id` (the slugified heading), never by `key`.

### 1.1 Accepted H6 headings

The H6 heading text (up to the first tab) is lower-cased and matched against a fixed table.

| H6 heading (any case) | Section key |
|---|---|
| `Unit Composition` | `unitComposition` |
| `Standard Wargear` | `standardWargear` |
| `Armour Options` | `armourOptions` |
| `Wargear Options` | `wargearOptions` |
| `Force Organization` / `Force Organisation` | `forceOrganization` |
| `Special Abilities` / `Abilities` | `specialAbilities` |
| `Leader` / `Led by` | `leader` |

A heading **not** in that table is resolved in this order:

1. it matches an upgrade-catalog **Category** for the faction → catalog-backed key characteristic (§3.8);
2. it is followed by H7 option blocks → inline key characteristic (§3.8);
3. it is listed in `PROSE_ONLY_H6` in the parser → `additionalRules`, rendered as prose;
4. otherwise → **hard error**.

> Unrecognised headings used to be **dropped silently**, which is how five whole rules
> (*Path of Study*, *Harnessed God*, *Shaper's Path*, *To Gork, or Mork*, *Paths of the
> Aspect Shrines*), fourteen *Gifts of Chaos* explanations and four units whose heading
> read `Abilities` instead of `Special Abilities` went missing from the builder without a
> single warning. Rule 4 is deliberate: a new free-form prose heading costs one line in
> `PROSE_ONLY_H6`, and a typo costs a build.

### 1.2 Slot taxonomy

Clauses may name an equipment **slot**. A `replaces: {slot}` target resolves to whatever fills that slot; `choose`/`replace` clauses that name a slot share a per-model pool at runtime (§7.3).

| Slot | Recognised label(s) in prose | Set by |
|---|---|---|
| `primary-ranged` | `Primary Ranged Weapon(s)` | `[label]` after "of the following", or a replace target |
| `primary-melee` | `Primary Melee Weapon(s)` | ditto |
| `secondary-ranged` | `Secondary Ranged Weapon(s)` | ditto |
| `secondary` | `Secondary Weapon(s)`, `Additional Secondary Weapon(s)` | ditto |
| `armour` | a name in the armour list below | `replace its <X> Armour …` |

Armour names are matched against a fixed list: Tacticus, Phobos, Gravis, Terminator, Scout, Saturnine Terminator. **A new armour type must be added to `ARMOUR_NAMES` in the parser** or it is treated as an ordinary weapon name in the replace target.

> **A `[label]` is always optional and never required.** An unrecognised label is *not* an error — the clause is simply slot-agnostic (its options still parse). Supply a label only when you want the clause pooled against a slot. There are no `mount` or `accessory` slots; mounts, grenades and accessories are ordinary `add` clauses.

---

## 2. The clause object

```jsonc
{
  "id": "wargearOptions-replace-3",   // "<sectionKey>-<op>-<n>" — unique within the unit
  "prose": "<p>Up to 2 Honour Guard in the unit can replace their Primary Ranged weapon with 1 of the following:</p>",
  "op": "fixed",            // fixed | choose | replace | add | modifier
  "scope": {
    "who": "count",         // each | unit | unitPool | count | ratio
    "modelType": "Honour Guard",       // present when the subject names a model type/role
    "count": 2,                        // who=count
    "ratio": { "perX": 10, "n": 2 },   // who=ratio
    "requires": null                   // §2.3 conditional predicate
  },
  "replaces": { "slot": "primary-ranged" },   // {slot} | {weapon} | {slot,weapon} | {weapons:[…]} | null
  "slot": "primary-melee",  // optional: slot named by a "…of the following <label>:" clause
  "pick": { "min": 0, "max": 1, "distinct": false },   // §2.1
  "options": [ /* §2.2 */ ],
  "altGroup": "wargearOptions-add-2",  // id of the clause this one is an alternative to (§2.5)
  "compoundGroup": "wargearOptions-cmp-4",  // set on the clauses of a split compound replace (§3.4)
  "appliesTo": { "weapon": "Dreadnought Power Fist" },  // modifier clauses only
  "modifier": "Relic Weapon",          // modifier clauses only
  "modifierRef": "wargear:relic-weapon",
  "pointsPerWeapon": 10
}
```

Section-level `notes[]` collects footnote lines (§3.6) for display.

### 2.1 `pick` (cardinality)

| Source phrasing | pick |
|---|---|
| `…must be equipped with 1 of the following` | `{min:1,max:1}` |
| `…can be equipped with / can replace … 1 of the following` | `{min:0,max:1}` |
| `…can be equipped with up to N of the following` | `{min:0,max:N}` — **repeatable**, see §7.2 |
| `…must be equipped with N of the following` | `{min:N,max:N}` |
| `…must be equipped with N of the following, but can only select 1 of each option` | `{min:N,max:N,distinct:true}` |
| `…can be equipped with any of the following` | `{min:0,max:null}` |
| `…can be equipped with up to Nx [item]` | `{min:0,max:N}` (single option) |

### 2.2 `options[]`

```jsonc
{
  "ref": "weapon:lascannon",
  "name": "Lascannon",
  "kind": "weapon",              // weapon | wargear
  "qty": 1,
  "modifiers": ["twin-linked"],
  "points": 40,                  // null if any component is uncosted → UI shows "see rules"
  "parts": [ {"ref":…,"name":…,"kind":…,"qty":…,"modifiers":[…]}, {"text":" and "} ],
  "and": [ { "ref":…, "name":…, "kind":…, "points":… } ]   // extra components, if any
}
```

**How an option line is read** (in order):

1. Trailing footnote markers (`*`, `**`) are stripped; curly quotes/dashes are normalised.
2. The line is split on ` and ` / ` with `, **keeping the separators** — each component resolves independently and gets its own tooltip. `parts[]` preserves the original order, interleaving resolved refs with plain text (connectors, uncosted labels such as a turret name).
3. Each component may carry a leading quantity — `2x Autocannon`, `2 Autocannon`, `up to 2 Autocannon` — or a leading article (`a` / `an` / `1`).
4. Weapon-name **modifier prefixes** are then stripped: `Twin-linked` and `Accursed`. They **stack, in either order** (`Twin-linked Accursed Heavy Bolter`), and each adds its own cost (§2.4).
5. The remainder resolves against `units.weapons` then `faction-wargear` by slug, trying exact / singular / plural.

**Error policy:** if **no** component of a line resolves, that's a hard error. If *some* resolve, the unresolved fragments are recorded as **warnings** (`uncosted compound label(s) …`) and carried as plain text — this is what allows composites like `Turret Weapon with 2x Heavy Bolter`.

**Ref disambiguation.** Selections are keyed by `ref`, so options within one clause that share a base weapon must not collide. The parser appends suffixes: `#q<n>` for a quantity ≠ 1, `#m-<mod>[+<mod>]` for modifiers, `#c-<slug>` for a composite. E.g. `2x Twin-linked Storm Bolter` → `weapon:storm-bolter#q2#m-twin-linked`. Tooltips use the un-suffixed refs inside `parts[]`.

### 2.3 `scope.requires` (conditional predicate)

| Source phrasing | requires | UI hint |
|---|---|---|
| `If this model/the unit is equipped with [X] Armour, …` | `{ "armour": "X" }` | "Requires X Armour" |
| `Every/Any/This model equipped with a [w1] or [w2] can be equipped with …` | `{ "weaponIn": ["w1","w2"] }` | "Requires w1 or w2" |
| `If [subject]'s [only\|Primary] Ranged weapon(s) has/have the [kw] keyword, …` | `{ "weaponKeyword": "kw" }` | "Requires a kw weapon" |
| `Any weapon … (excluding [kw] weapons) can be upgraded …` | `{ "excludeKeyword": "kw" }` | — |

The UI caps a `requires` clause to 0 until its predicate holds for the model in question; points ignore it while inactive.

### 2.4 Weapon modifiers and their cost

Two mechanisms share the word "modifier":

**(a) Name-prefix modifiers** — `Twin-linked`, `Accursed` written into an option name (§2.2 step 4). Cost is **fully data-driven** from the modifier's `faction-wargear` entry `mechanics.rows[]` — the parser contains no per-modifier arithmetic, so a new modifier needs source data only:

- Each row carries a `target.filter` (`weaponClass` / `weaponKeyword` / `weaponStat`) and a `points` op — `delta` (add), `mult` (multiply, rounded up) or `set`.
- **Most specific matching row wins** (keyword > stat > class), not the first listed.
- **Resolve order is fixed and is not the order the words appear in the name:** flat modifiers (`points.op: delta|set`) apply first, each folding its Strength delta into the working weapon; *proportional* modifiers (`points.op: mult` — today only Twin-linked) apply **last**, so the tier is chosen against the weapon's **effective** Strength and the surcharge compounds on the already-upgraded cost.
- A weapon with model-relative Strength (`S`, `S +3`) can't satisfy a Strength-tiered filter and is tiered as `S = 0` (the lowest tier).
- If no row matches, the item's flat `pointsCost` is added.
- `public/js/weapon-mods.js` implements the identical rule at runtime.

**(b) `op:"modifier"` clauses** — an upgrade applied to an *already-chosen* weapon, so the UI can show which weapon is upgraded:

- **Blanket** (`Any weapon … can be upgraded to a Relic Weapon`) — no `appliesTo`; renders as a counter, and each marked weapon is priced by resolving it with and without the modifier (the real marginal cost, which correctly re-tiers an existing Twin-linked surcharge).
- **Per-weapon-instance** (`Each [weapon] equipped by this model can be upgraded to include 1 of the following:`) — carries `appliesTo:{weapon}`, `pick:{min:0,max:1}`; the clause cap equals the number of that weapon currently equipped.

### 2.5 `altGroup` (alternatives)

`Instead of [X], …` and `Alternatively, …` set `altGroup` to the **id of the immediately preceding clause**. It is currently **carried for display/data only — the engine does not enforce mutual exclusivity** (see §8). Author alternatives knowing both branches remain selectable in the builder today.

---

## 3. The authoring grammar (template table)

Author option sentences **only** in these forms. List items follow on their own lines beneath the sentence that opens the list.

**Placeholder glossary**

| Placeholder | Meaning | → maps to |
|---|---|---|
| `[role]` | A model designation/type *within* the unit (e.g. `Sergeant`, `Honour Guard`, `Novitiate`). Must resolve to a model type in `composition.modelTypes` or a named role. | `scope.modelType` |
| `[subject]` | The actor phrase that opens the clause — see §3.3. | `scope.who` (+ `modelType`) |
| `[weapon]` | A weapon being replaced; resolves to a `weapon:` ref or a slot label. | `replaces` |
| `[item]` | Any equippable weapon or wargear item. | `options[].ref` |
| `[specific]` | A single named item in a direct (no-list) replace/add. | single `options[]` entry |
| `[label]` | Optional weapon-class label naming the target slot (§1.2). | `slot` |
| `[armour]` | A faction armour type. | `replaces.slot:"armour"` |
| `[modifier]` | A weapon-upgrade name (Relic Weapon, Accursed, …). | `op:"modifier"` |
| `[kw]` | A keyword used in an exclusion or condition (`Grenade`, `Pistol`). | `requires` |
| `[N]` / `[X]` | Integers: `[N]` = how many models/picks; `[X]` = the "for every X models" denominator. | `scope.count` / `pick` / `scope.ratio` |

### 3.1 Standard Wargear (fixed equipment)

| Template | → clause |
|---|---|
| `[item]` on its own line (optional `Nx` prefix) | `fixed`, who:each |
| `[subject] is equipped with [item].` | `fixed`, who:each |
| `[subject] is equipped with [A] and [B].` | two `fixed` clauses |
| `[subject] is equipped with the following:` *(or a bare trailing `:`)* | `fixed` list-intro; the lines beneath become its options |
| `[subject] must be equipped with 1 of the following [label]:` | `choose`, pick{1,1} |
| `[subject] must be equipped with [N] of the following, but can only select 1 of each option:` | `choose`, pick{N,N,distinct} |
| `1 of the following [label]:` *(subject omitted)* | `choose`, who:each, pick{1,1} |
| `[Additionally,] [subject] knows the following Psychic Attacks:` *(list follows, or inline after the colon)* | `fixed` — psychic attacks are gained exactly like fixed wargear |

**`[subject]` for an `is equipped with` / `knows` sentence** is one of:

- **Generic** (equips the whole unit): `Every model`, `Each model`, `Every model in the unit`, `This model`, `The unit`.
- **Named** (equips only that model type): `Every [role]` / `Each [role]` — e.g. *"Every Cultist is equipped with a Brutal Assault Weapon."* This is the standard way to frame compulsory wargear on a unit with more than one model type, and it bills only that type's model count.

Only in **Standard Wargear** does a bare unmatched line become a fixed item. The same line in Armour/Wargear Options with no open list is a **hard error**.

### 3.2 Armour Options

| Template | → clause |
|---|---|
| `Every model can replace its [armour] with 1 of the following:` | `replace`, who:unit, replaces{slot:armour}, pick{0,1} |
| `This unit can replace its [armour] with 1 of the following:` | `replace`, who:unit, replaces{slot:armour} |
| `This model can replace its [armour] with [specific].` | `replace`, single option |

A unit-level **replace** is always a uniform swap (`who:"unit"`), never a pool — the parser downgrades `unitPool` → `unit` for `op:"replace"`.

### 3.3 Subjects → `scope`

The subject phrase fixes **who** the option applies to. For "Every model" the **verb** (can vs must) changes the scope.

| Subject phrasing | who | meaning | cost |
|---|---|---|---|
| `Every/Each model … can …` | `unit` | **uniform, all models** — if taken, *every* model gets it (all-or-nothing) | option × model count |
| `Every/Each model … must …` | `each` | **per-model, compulsory** — each model picks its own (models may differ) | sum of each model's pick |
| `Any model … can …` / `This model …` / `It …` | `each` | **per-model, optional** — 0…N models may each take it | option × number given it |
| `Any/Every/Each [role] … can/must …` | `each` (+modelType) | **per-model of a named role** — role-restricted, never bills other roles | option × number given it |
| `The [role]` / `1 [role]` | `count` (count:1, +modelType) | a single named role/model | option × number taken |
| `Up to [N] [role]` | `count` (count:N) | up to N of that role | option × number taken |
| `For every [X] models, [up to] [N] [role]` | `ratio` (perX:X, n:N) | ratio-limited | option × number taken |
| `The unit …` / `This unit …` | `unitPool` | **finite unit-level pool** — e.g. `The unit can be equipped with up to 2 Cherubin` = 2 total, *not* 1 per model. Rendered as a 0…N stepper | option × **number selected** |

`in the unit` / `in this unit` may follow the subject in any of these forms (`Up to 2 Honour Guard in the unit can …`).

**Authoring rule:**

- Uniform selection every model takes → **"Every model … can …"** (cost × model count).
- Finite unit-level upgrade (a fixed number of items for the whole unit) → **"The unit can be equipped with [up to] [N] [item]"** (cost × items selected). **"The unit can …" and "Every model … can …" are NOT equivalent.** The unit-level *replace* (shared armour) is the exception — it stays uniform.
- Compulsory per-model selection → **"Every model must …"**.
- Optional per-model → **"Any model can …"**.
- Restricted to a named role → **"Any [role] can …"** (optional) / **"Every [role] can/must …"**. `Each [role]` is a synonym of `Every [role]`. Role subjects are **always** per-model — there is no "uniform role" scope — which keeps points correct on mixed-role units (a role subject must never bill the unit's other models).

### 3.4 Verbs → `op` / `pick` / `replaces`

| Template (after the subject) | → clause |
|---|---|
| `… can/must replace its/their [weapon] with 1 of the following:` | `replace`, replaces{weapon}, pick{0,1} — **colon required** |
| `… can/must replace its/their [A] and [B] with 1 of the following:` | `replace`, replaces{weapons:[A,B]} |
| `… can/must replace its/their [weapon] with [specific].` | `replace`, single option (no colon, no "of the following") |
| `… can/must replace its/their [weapon] with [N] [category] and [N] [category] … from the following [list]:` | **compound** → split (see below) |
| `… can be equipped with 1 of the following [label]:` | `add`, pick{0,1} |
| `… can be equipped with up to [N] of the following [label]:` | `add`, pick{0,N} — repeatable (§7.2) |
| `… can be equipped with any of the following [label]:` | `add`, pick{0,null} |
| `… must be equipped with [N] of the following [label]:` | `choose`, pick{N,N} |
| `… must be equipped with [N] of the following, but can only select 1 of each option:` | `choose`, pick{N,N,distinct} |
| `… can/must select [N] of the following:` | as "be equipped with" |
| `… can be equipped with the following:` *(bare, list follows)* | `add`, pick{0,1} |
| `… must be equipped with the following:` *(bare, list follows)* | `choose`, pick{1,1} |
| `… can be equipped with [item].` | `add`, single option, pick{0,1} |
| `… must be equipped with [item].` | `fixed`, single option |
| `… can be equipped with up to [N]x [item].` | `add`, single option, pick{0,N} |

> **`[label]` and the trailing `:` are both optional** on the "…of the following" forms — the phrase *of the following* already names the list. `can be equipped with 1 of the following`, `…up to [N] of the following` and `…any of the following` are all valid without a label. Supply a `[label]` only to pin the target slot. The `replace … with 1 of the following` form is the exception: it **must** end in a colon.

> **Compound category replacement** — e.g. `Any model can replace its Lasrifle with 1 Pistol and 1 Melee weapon from the following list:` followed by a mixed list. Each `[category]` is a weapon **keyword** (`Pistol`, `Grenade`, …) or **class** (`Melee weapon` / `Ranged weapon`); the trailing "weapon(s)" is optional and keywords are singularised. The parser splits the shared list by category and emits one clause per segment — the **first** a `replace` (it gives up the named weapon), the rest `add` — each capped at its own segment count (`who:count`, `count:N`), sharing a `compoundGroup` so the UI renders them as one seamless list. Two or more segments are required. A category matching no list item is a hard error; a list item matching no category is a warning.

### 3.5 Modifiers, conditionals, alternatives

| Template | → clause |
|---|---|
| `Any/Every/Each [adjective] weapon … can be upgraded to/as a [modifier].` | `modifier`, who:each |
| …with `(excluding [kw] weapons)` anywhere in the sentence | + `requires{excludeKeyword:kw}` |
| `Each [weapon] equipped by this model can be upgraded to include 1 of the following:` | `modifier`, appliesTo{weapon}, pick{0,1} |
| `If [this model/the unit/a …] is equipped with [armour], [subject] can [then] be equipped with …` | clause + `requires{armour}` |
| `[Every/Any/This] model equipped with a [w1] or [w2] can be equipped with [item].` | `add` + `requires{weaponIn:[…]}` |
| `If [subject]'s [only\|Primary] Ranged weapon(s) has/have the [kw] keyword, …` | clause + `requires{weaponKeyword:kw}` |
| `Instead of [X], [subject] can [instead] be equipped with:` | clause + `altGroup` = preceding clause |
| `Alternatively, [clause].` | clause + `altGroup` = preceding clause |

The blanket-modifier sentence is deliberately loose in the middle — `Any weapon equipped by this model …`, `Any eligible weapon equipped by any model in the unit …` and `Every ranged weapon …` all match. The modifier name resolves against `faction-wargear`; a trailing "Weapon" is dropped on a second attempt, so `upgraded to an Accursed Weapon` finds the item named `Accursed` while `Relic Weapon` still matches exactly. **An unresolved modifier name is a hard error.**

`can then be equipped` and `can instead be equipped` are normalised to `can be equipped`, so conditionals and alternatives read naturally.

### 3.8 Key unit characteristics

A **key unit characteristic** is a selection made inside a unit that confers an array of
changes on it — wargear, abilities, keywords, points, and (for display) the units it may
lead. *Path of Study*, *Harnessed God*, *Shaper's Path*, *To Gork, or Mork*, *Paths of the
Aspect Shrines*, *Gifts of Chaos*.

It is always **its own H6 section** under the unit, with a free-form flavour heading. The
heading text is the display label; it is also the join key when the options live in a
faction catalog, in which case it must equal the workbook **Category** exactly.

**Intro sentence** (required for the inline form, optional for the catalog form):

| Template | → `select` |
|---|---|
| `[subject] must select [N] of the following <label>[, <free tail>].` | `{min:N, max:N}` |
| `[subject] can select up to [N] of the following <label>[, <free tail>].` | `{min:0, max:N}` |

The sentence is **searched for anywhere in the paragraph**, so a flavour sentence may
precede it ("Each Shard of Transcendent C'Tan is a shard of a specific god … This model
must select 1 of the following Harnessed Gods, which determines its Wargear and
Abilities."). Everything after the comma is free text.

**Form A — inline** (options are unit-specific and define its wargear):

```
H6  Path of Study                       ← free-form label
    This model must select 1 of the following Paths of Study, which determines …
  H7  Technomancer                      ← one per option
    H8  Wargear:                        ← ordinary §3 sentences and lists
    H8  Special Abilities:              ← prose  (`Abilities:` also accepted)
    H8  Leader:                         ← prose, optional
```

- The `Wargear:` block is parsed with **Standard Wargear semantics** — a bare item line is
  compulsory wargear, and any §3 template works. That is what lets a profile contain
  nested picks (the Kroot Shaper's Paths each open two `must be equipped with 1 of the
  following:` lists) with no new grammar.
- Items directly under an H7 with no H8 are treated as `Wargear:` (the Gorkanaut form).
- An option with no `Wargear:` block is legal and grants nothing (*Unformed Shard*).
- Clause ids are namespaced `<sectionId>-<profileId>-<op>-<n>`, so two profiles never collide.

**Form B — catalog-backed** (options are a priced pool shared by several units):

```
H6  Paths of the Aspect Shrines         ← MUST equal the workbook Category
    This model can select up to 4 of the following Paths of the Aspect Shrines:
    Path of Asurmen                     ← optional; styled Wargear/Weapon
    …
```

No H7 blocks. Listed option lines are validated against the catalog — a styled line that
names no catalog item is a **hard error**; an unstyled line is narrative prose. Listing a
subset restricts the unit to it; listing none offers the whole catalog.

Cardinality for Form B comes from the **`Upgrade Allowance`** column where present (it is
the only place `champion` scope can be expressed); the prose cap fills in where the column
is blank, and a disagreement between the two is a warning with the column winning.

### 3.6 Notes and footnotes

| Template | Effect |
|---|---|
| A line beginning `*` | Footnote — added to the section's `notes[]` and rendered as a footnote paragraph. Not a selectable option. |
| A sentence beginning `Additionally, …` | Informational note (no selection), unless it is an `Additionally, … knows the following Psychic Attacks` line (§3.1). |
| `*` / `**` at the end of an **option** name | Stripped before resolution — the marker never breaks a lookup. |

### 3.7 What fails the build

- An unrecognised sentence in `armourOptions` / `wargearOptions` with no open list.
- An option line where **no** component resolves to a weapon or wargear item.
- An unresolved blanket-modifier name.
- A compound category that matches no item in its list.

Warnings (non-fatal, printed at the end of the run): partially-resolved option lines, compound list items matching no category, unparseable Upgrade Allowance segments.

---

## 4. Composition

`composition` is built from the Excel unit row, with the Unit Composition prose carried in `prose`.

| Source | composition |
|---|---|
| Single-statline unit, squad size `1` | `mode:"single"`, `range:{min:1,max:1}` |
| Single-statline unit, squad size `5 to 10` | `mode:"range"`, `range:{min:5,max:10}` |
| Multi-statline unit (one Excel row per model type) | `mode:"multi"`, `modelTypes:[…]` |

Every mode carries `modelTypes[]`; each entry is `{name, stats, basePoints, keywords}` plus, when the workbook supplies them:

- `countLimit` — a ratio-limited count from **Squad Size Constraints** (e.g. 1 per 5 models).
- `transform` — a coupled composition change, e.g. *"1 Heavy Weapons Team = -2 Guardsmen"*, which the builder applies when the count of that model type changes.

Keywords are per model type (they may differ between types within a unit).

---

## 5. Force Organization

The `Force Organization` H6 prose is parsed into structured rules; the raw text is always retained in `raw` for display.

| Source | forceOrg |
|---|---|
| `…can only include 1 [unit] in games of 2,000 points or less, and can include up to 2 …` | `{ "tiers": [ {"maxPoints":2000,"count":1}, {"minPoints":2001,"count":2} ], "raw": … }` |
| `1 [unit] for every Senior Officer, Junior Officer or Epic Hero in your army` | `{ "onePerEach": ["Senior Officer","Junior Officer","Epic Hero"], "raw": … }` |
| `…can only include [this unit] if it includes at least [N] other [Keyword] units` | `{ "requiresOther": {"keyword":"Keyword","min":N}, "raw": … }` |
| Anything else | `{ "raw": "<prose>" }` (display only) |

**Mount hosts** are additionally read from the unit's **Standard Wargear**: a paragraph matching `must be mounted in … of the following …` followed by host names on their own lines (terminated by an `After selecting …` paragraph) yields `forceOrg.mount = { "hosts": ["Sentinels", …] }`. Host names may be model variants (`Scout Sentinel`) — they resolve to the owning unit name. The builder restricts mounting to the allowlist, drops `Titanic` hosts below 1,500 points, and excludes an occupied host from the units counted toward a `requiresOther` minimum.

The Warlord sub-clause ("1 of those units must be your Warlord unless…") stays in prose; the Warlord requirement is enforced globally by the validation engine, not per unit.

---

## 6. Inputs authored outside the prose grammar

These reach the same canonical record from the Excel workbooks, not from sentences. Listed here so authors know the sentence grammar is *not* the only lever.

### 6.1 Upgrade Allowance & selectable upgrade catalogs

A **catalog** is any workbook Category that is neither `Wargear Upgrades` nor `Detachment Traits` (e.g. *Gifts of Chaos*). Its rows are **tiers** — statline bands with their own points — and it is emitted to `src/data/upgrade-catalogs/{slug}.json`. The converter treats the name as data; nothing is faction-special-cased.

Per-unit entitlement is the **Upgrade Allowance** column on the unit's model row — a sparse, header-driven column, `;`-separated, each segment `"<count> <scope>"` where scope is:

| Segment | Meaning |
|---|---|
| `N unit` | the unit picks N catalog items, applied to **every** model (priced per model) |
| `N model` | **each** model of this row's type independently picks N items |
| `N champion` | the unit's single champion model picks N extra items |

Selections are distinct within an allowance. Blank → no catalog access. An unparseable segment is dropped with a warning.

A unit may instead (or additionally) declare its access in prose, by giving the catalog
its own H6 section — see §3.8 Form B. Where both exist the column wins and the mismatch is
warned; where only the prose exists it supplies a `unit`-scope allowance.

Catalog **rules text** is harvested by `convert_faction_wargear.py` from the docx H3 block
whose heading matches the Category (the same `H6 Name<tab>N Points` + prose shape used by
Wargear Upgrades) into `faction-wargear/{slug}.json` → `catalogItems[]`, and merged onto
the catalog items by `convert_upgrades.py`. Those items are deliberately kept **out of**
`wargearItems[]` so `convert_options` cannot resolve them as ordinary, separately-priced
wargear — a Path is priced by the catalog and nowhere else — while the tooltip lookups on
both surfaces are given the two lists concatenated.

### 6.1b Force Org Constraints

The machine-readable form of a unit's **Force Organization** H6. The prose stays authoritative for the reader; this column is what the List Builder enforces. Sparse and header-driven like the columns above, authored on any one of the unit's model rows (a conflict between two rows of the same unit is warned, first wins). Absent → the unit falls through to the keyword defaults (Epic Hero 1, Character 1 per 1,000 pts, Battleline 2 per 500 pts, else 2 per 1,000 pts).

Separators: **`;`** between atoms (all must hold) · **`|`** ORs references inside one atom · **`+`** ANDs terms within one reference.

| Atom | Meaning |
|---|---|
| `max N` | flat cap per army |
| `max N per <P>pts` | N for every P points — never below N, so a small game can still field a per-2,000-pts unit |
| `max N to <P>pts` | tier: N while battle size is at most P |
| `max N above <P>pts` | tier: N once battle size exceeds P |
| `max N per <ref>` | N for every **other** in-army unit matching `<ref>` |
| `requires N <ref>` | army must include N **other** units matching `<ref>` |
| `ignores character` | exempt from the default Character cap (falls through to the generic default) |
| `warlord` | if included, one of these units must be the Warlord |
| `warlord unless <ref>` | …unless the army also includes a unit matching `<ref>` |

A `<ref>` is a **unit name**, a **keyword**, or `Epic Hero`, matched case-insensitively and resolved at build time against the faction's own vocabulary. An unresolvable reference drops its atom with a warning — never a limit of 0, because an authoring typo must not silently block a legal list.

Both `requires` and `max … per` count **other** units. The source prose reads "at least 1 other …", and a referencing unit routinely carries the referenced keyword itself (a Squadron Commander *is* `Squadron`; a Commissar *is* `Regiment`), which would otherwise let it satisfy its own rule.

```
max 1 per 2000pts; warlord unless Epic Hero     Senior Officer
max 1 to 2000pts; max 2 above 2000pts           Captain
max 5 per 500pts                                Infantry Section (overrides Battleline)
max 1 per Senior Officer|Junior Officer         Command Squad
requires 1 Militarum Tempestus Scions+Infantry  Militarum Tempestus Taurox
ignores character                               Junior Officer
```

Where the H6 and the column disagree in *existence* — one present without the other — `convert_options` reports it and reconciles nothing; the author decides. Multiple atoms yielding a cap are all evaluated and the tightest wins. The Squadron Commander host allowlist is **not** part of this column: it is still harvested from the "must be mounted in 1 of the following" Standard Wargear prose into `forceOrg.mount`, and is carried across when the column supplies everything else.

`_lb-forceorg.cjs` pins the resulting verdicts for every Force Organization H6 in the game, including the ones still awaiting a cell — those are asserted to stay permissive.

### 6.2 Wargear mechanics rows

`faction-wargear` items carry `mechanics.rows[]` (from the Wargear Upgrades workbook) describing model/weapon stat deltas, keyword add/remove, and the `points` op that drives §2.4. Keyword effects are **add/remove only** — no arithmetic.

### 6.3 Statline bands (`Target Domain: model` + `Target Filter`)

A `Target Filter` means different things per domain, and the converter reads it accordingly:

| Domain | Filter means |
|---|---|
| `weapon` | a weapon filter — `Ranged`/`Melee`, a weapon keyword, a weapon name, or a stat threshold (`Strength<8`) |
| `model` | a **statline band** on the model's own characteristic — `Toughness 4:6`, `Toughness <=3`, `Toughness>=7` |
| `unit` | nothing — a filter here is a hard error |

A band selects which of an item's rows applies to a model, and with it that row's **points tier**. This is one grammar with two uses: a catalog tier (*Mark of Khorne*: 2 pts at `Toughness <=3` … 25 at `Toughness >=10`) and a **banded wargear upgrade** (*Adrenal Glands*: 5 pts at `Toughness <=3`, 15 at `Toughness>=4`). Category does not change how the filter is read.

Rules the converter enforces per item:

- all model rows banded, or none — no mixing;
- one band stat across the item;
- no overlapping bands (so exactly one row can match a model);
- each banded row carries a plain per-model number in `Points Cost` — an `xN` multiplier has no base to multiply on the model domain.

Gaps *are* allowed: a model no band covers simply cannot take the item, and the builder renders it disabled.

The item's prose `pointsCost` stays `null` with `costNote: "varies"` — the tiers are the price, and the Faction Rules Index prose keeps stating them for the reader. Bands are matched against the model's **base** statline, never its upgraded one, so two banded upgrades on one model cannot re-tier each other by order of selection.

### 6.4 Wargear-item prose — compulsory inclusions and sub-selections

§3 governs the **unit's** sections. A **wargear item's own** rules text is a different block, parsed by `convert_faction_wargear.py` from the Faction Rules Index *Wargear Upgrades* H3, one H6 per item (`Name<tab>Cost`) followed by effect paragraphs, into `faction-wargear/{slug}.json`.

Most effect lines are rules prose and are kept verbatim for the tooltip. Two line shapes are *structural* — they build the controls the builder renders. A combi-style item (Combi-Bolter, Kombi-Shoota) needs both:

```
Combi-Bolter	Varies (see below)
The bearer is equipped with a Boltgun.
The bearer must be equipped with 1 of the following:
Flamer
Meltagun
Plasma Gun
```

→ `includedWeapons: [Boltgun]` (read-only, always present) + `subSelections[0].pick = {min: 1, max: 1}` (compulsory, exactly one).

#### A. Compulsory inclusion → `includedWeapons`

> `The bearer is equipped with <weapon>.`

| Rule | Detail |
|---|---|
| Verb | Must contain **`is`** or **`are`** before `equipped with`. This is the *entire* distinction from restriction lines — `cannot be equipped with`, `can only be equipped with`, `must be equipped with` all lack it and are correctly ignored. |
| Subject | Optional. **Use `The bearer`.** Also accepted: none (`Is equipped with a Dozer Blade`, inheriting the item's `The bearer:` header), `Models equipped with <item> are …`, and `The <Item>` where the name is **one or two words** — `The Ridgehauler Heavy Gear Mount is …` does *not* match. |
| Forbidden | The line must **not** contain `of the following`. |
| Cleanup | A leading `a` / `an` / `the` is stripped, as is a trailing `Melee weapon` / `Ranged weapon` descriptor. `the Scything Blades Melee weapon` → `Scything Blades`. |
| Two weapons | Join with `and`: `The bearer is equipped with 1 Snazzy Shoota and 1 Killa Jet.` |
| Many weapons | End the line with `the following` and list them beneath — one per line, ≤6 words, no trailing `.` or `:`. Collection stops at the first sentence or unresolvable name. |
| Modifiers | Work as anywhere else: `a Twin-linked Boltgun`. |

#### B. Compulsory selection → `subSelections`

> `The bearer must be equipped with <quantity> of the following<label>:`

| Rule | Detail |
|---|---|
| Terminator | The intro **must end with `:`**. |
| Quantity | A token immediately before `of the following`: `a`/`an`, a digit, `up to N`, `any`, or `any number of`. |
| Compulsory | The word **`must`** in the intro is what sets `min`. Without it `min` is 0 — the selection becomes optional. |
| Label | Optional, between quantity and colon: `1 of the following Ranged weapons:` → label *Ranged weapons*. Parentheticals are dropped, so `(at the points cost specified)` is safe. |
| Forbidden | `cannot`, `not be`, `excluding` — those read as restriction intros and are skipped. |
| Option lines | ≤8 words, **no trailing `.`**, and must resolve to a weapon/wargear name in the faction catalogue. The first line that is a sentence, exceeds 8 words, or fails to resolve **closes the group**. |

Resulting cardinality:

| Intro | `pick` | Builder control |
|---|---|---|
| `must be equipped with 1 of the following:` | `{min: 1, max: 1}` | radio, compulsory |
| `can be equipped with 1 of the following:` | `{min: 0, max: 1}` | radio, clearable |
| `can be equipped with up to 2 of the following:` | `{min: 0, max: 2}` | steppers to 2 |
| `can be equipped with any of the following:` | `{min: 0, max: null}` | checkboxes, unbounded |
| `…of the following but can only select 1 of each:` | adds `distinct: true` | once-each |

> The `distinct` suffix must follow `of the following` with **no comma** — a comma breaks the intro match and the group is lost entirely. It is also consumed as the group's label, so it shows as the panel heading. No wargear item uses it today; prefer `up to N` unless you need once-each.

#### C. Pricing

An included weapon's cost comes from the weapon data tables and is **added on top of the item's H6 cost**. Therefore:

- The H6 cost must be the item's price **excluding** its included weapon.
- When the item is *nothing but* its base weapon plus a selection — every combi weapon — give it `Varies (see below)` so the price is entirely `included weapon + selection`. Any non-numeric cost string yields `pointsCost: null`, `costNote: "varies"`.
- A weapon with no points in the tables (Dozer Blade, Squigosaur) contributes nothing, so items carrying one keep their flat H6 cost.

#### D. Failure modes

These do not raise an error — they silently produce the wrong control, so they are worth knowing:

| Written | Produces |
|---|---|
| `The bearer is equipped with a Boltgun and 1 of the following:` | **No included weapon.** The line reads as a selection intro; the Boltgun is lost. Split it into two lines. |
| `The bearer is equipped with 1 of the following:` | Selection with `min: 0` — `is` is not `must`, so nothing is compulsory. |
| `A Combi-Bolter is a Boltgun that must also include 1 of the following:` | Selection only. The weapon is inside the intro sentence, so it is not an inclusion. |
| An option line ending in `.` | Closes the group: that option and every line after it is dropped, and if it was the first option the group vanishes entirely. |

---

## 7. What a clause does at runtime

Authoring choices in §3 determine the control the builder renders and how the cost is billed. This section is descriptive — it is how `list-builder.js` / `list-builder-ui.js` behave today.

### 7.1 Control type

Control type is a function of the clause and unit only (never of current selections), so it stays stable while editing:

| Clause | Control |
|---|---|
| `modifier` without `appliesTo` | counter |
| `modifier` with `appliesTo` | stepper, capped at the number of that weapon equipped |
| `who:"unitPool"` | stepper, `n/N in unit` |
| `who:"unit"` | radio if `pick.max === 1`, else checkbox; labelled *all models* |
| Single-model unit, `pick.max === 1`, >1 option | radio |
| Single-model unit, `pick.max > 1` and not distinct | stepper (repeatable) |
| Single-model unit, otherwise | checkbox |
| Multi-model unit | stepper |

### 7.2 Repeatable "up to N" lists

A non-distinct `pick.max > 1` list is **repeatable**: the same option may be taken more than once (2× Multi-melta), and on a single-model unit it renders as a stepper rather than checkboxes. An automatic **kind rule** applies within such a list: **wargear** options cap at 1 each, **weapons** repeat up to the clause total. Adding `but can only select 1 of each option` (i.e. `distinct`) turns the whole list back into once-each checkboxes.

### 7.3 Slot pooling

`choose` and `replace` clauses that name a slot — and are not `who:"unit"` — share a per-model pool for that slot: total selections across those clauses cannot exceed the model count, shown as `n/N assigned`. `add` clauses never pool.

### 7.4 Suppression

A `wargearOptions` clause offering weapons is **suppressible**: if a model takes an item flagged as suppressing (e.g. a Paragon Warsuit, which brings its own weapons), that model is removed from the clause's cap, existing selections are clamped, and the UI explains why. Clauses whose own options include the suppressing item are exempt.

### 7.5 Points

| Clause | Billed |
|---|---|
| `fixed` | option points × the count of the model type it is scoped to |
| `choose` / `add` / `replace`, `who:"unit"` | option points × **total models** |
| `choose` / `add` / `replace`, any other scope | option points × number selected |
| `replace` with a named weapon | the replaced weapon's cost is subtracted once per affected model |
| `modifier` with `appliesTo` | option points × number of upgraded weapons |
| blanket `modifier` (Relic-style) | the **marginal** cost of adding the modifier to each marked weapon (re-resolved with/without) |
| statline-banded item (§6.3) | the tier the taking model's base statline falls in, per model — not the (null) option points |

A banded item on a unit with **several model types** is only exactly priceable when the clause says which models take it: `fixed` and `who:"unit"` cover every model, so each type is billed its own tier; a clause naming a model type bills that type. A per-model clause records only a *count*, never which models, so the builder charges the dearest matching tier and `convert_options.py` emits a warning naming the unit — rephrase the source as "Every model in the unit …" or name a model type to resolve it exactly. No current unit hits this.

Option `qty` is baked into `points` at parse time. Sub-selections (combi sub-weapons, turret/sponson weapons) are costed per instance and are not multiplied again by the clause scope.

### 7.6 Key characteristics at runtime

`clauses(u, entry)` — the single function every other part of the engine iterates for
pricing, caps, slot pools, availability and clamping — yields a `keyCharacteristic`
section's clauses only for the **selected** profile. Selecting a profile is therefore what
makes its wargear exist, and everything else follows with no special-casing. Called
without an `entry`, it yields every profile's clauses; that is what id lookups need in
order to find and clear a clause the player has just switched away from.

| Behaviour | Rule |
|---|---|
| Control | radio when `select.max === 1`, checkbox above it |
| Position | directly under the statline, above Standard Wargear — the choice determines what follows |
| Pricing | the profile's wargear is billed exactly like Standard Wargear, i.e. **on top of** `basePoints`; an authored flat `profile.points` is added as well |
| Compulsory | `select.min ≥ 1` auto-selects the first profile on add, refuses de-selection of the last, and reports a unit issue if unmet |
| Switching | selections belonging to the de-selected profile are purged from `sel` / `nested` / `relic` / `instanceCount` |
| Incomplete picks | a compulsory `choose` **inside a profile** is reported as a unit issue even without a slot label (elsewhere, unslotted compulsory chooses are still not tracked) |
| Catalog form | selection runs through the existing `upgradeAllowance` / gift machinery unchanged; the section supplies only label, prose and placement |

Catalog items carry an `effects[]` prose array harvested from the docx, shown under the
selected item and in its ref tooltip. Several Paths of the Aspect Shrines have no
mechanical row at all — the prose *is* the upgrade, and without it the options are
indistinguishable in the builder.

---

## 8. Deliberately not implemented

Kept here so nobody re-derives them from an old draft:

- **`form-team`** — the AM Heavy Weapons Team construction is no longer authored as a sentence; it is a composition `transform` (§4). There is no `form-team` op.
- **`op:"manual"` escape hatch** — no code path. A genuinely unrepresentable rule must be re-authored, not annotated.
- **`composition.mode:"tiers"`** — the parser recognises `A, or B` composition prose and emits `tiersRaw` (raw strings), but no unit currently uses it and the builder does not consume it. Treat tiered composition as unsupported.
- **`altGroup` enforcement** — emitted (§2.5) but no runtime code reads it, so alternatives are not yet mutually exclusive in the builder.
- **`mount` / `accessory` slots** — named in earlier drafts; the parser has no such labels. Mounts and accessories are ordinary `add` clauses.
- **Generated-prose modifier prefix** — only `Twin-linked` is echoed as a prefix when a resolved option is re-rendered as prose; an `Accursed [weapon]` option displays under its base weapon name.
