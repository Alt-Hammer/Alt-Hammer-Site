# Wargear Phrasing Audit
*Alt-Hammer 40,000 — Faction Rules Index, 1st Edition*

---

## Document Structure (relevant to wargear parsing)

Unit profiles live in **H3: Unit Profiles** sections within each faction. Within each H5 unit name, the relevant H6 sub-sections are:

| H6 Heading | Count | Notes |
|---|---|---|
| Standard Wargear | 316 | Compulsory equipment (names only; points from weapons JSON) |
| Wargear Options | 184 | Per-unit weapon swap/addition options |
| Wargear Upgrades | 60 | Synonymous with Wargear Options (alternate heading) |
| Weapon Options | 19 | Synonymous with Wargear Options (alternate heading, e.g. Rough Riders) |
| Armour Options | 10 | Armour replacement options; Adeptus Astartes Characters only — semantically identical to Wargear Options but scoped to armour types |

**Faction-level wargear** is a separate H3 section ("Wargear Upgrades") that lists items available to any eligible unit at the faction level. These are distinct from per-unit H6 options. Parsing must not conflate the two.

---

## Standard Wargear Formats

The H6: Standard Wargear section uses three distinct formats:

**Format A — Plain list (most common):**
```
Lasrifle
Refractor Field
```
One weapon name per paragraph, no additional text.

**Format B — Unit-level sentence:**
```
Every model in the unit is equipped with 1 Lasrifle
```
or:
```
Every model is equipped with the following:
  Hunting Lance
  Laspistol
```

**Format C — Sentence with multiple weapons:**
```
This model is equipped with 1 Laspistol and 1 Power Sword.
```

**Format D — Complex conditional paragraph (rare):**
Squadron Commander has a paragraph explaining the model must mount in another unit; that unit's wargear profile applies. This is a one-off and should be flagged as unparseable rather than silently dropped.

---

## Per-Unit Wargear Option Phrasing Patterns

### 1. replace-one-of *(most common — ~60% of option blocks)*

**Pattern:** "This model can replace its `[weapon]` with 1 of the following:"

```
This model can replace its Lasrifle with 1 of the following:
  Boltgun
  Shotgun
```

Variants that parse identically:
- "Every model can replace its `[weapon]` with 1 of the following:"
- "This unit can replace its `[weapon]` with 1 of the following:"
- "Every model in the unit can replace its `[weapon]` with 1 of the following:"
- "The `[Sergeant/model type]` can replace its `[weapon]` with 1 of the following:"
- "Any `[model type]` can replace its `[weapon]` with 1 of the following:" (Astra Militarum)
- "Any model can replace its `[weapon]` with 1 of the following:"

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: [weaponName]`.

---

### 2. replace-one-direct *(uncommon)*

**Pattern:** "This model can replace its `[weapon]` with `[specific weapon]`."

```
This model can replace its Exterminator Autocannon with 1 Twin-Linked Heavy Lascannon.
This model can replace its Tacticus Armour with Gravis Armour.
```

Effectively a replace-one-of with a single option in the list. No sub-list follows.

**Schema mapping:** Same as replace-one-of but `options` array has exactly 1 entry.

---

### 3. additive-pick-one *(common)*

**Pattern:** "This model can be equipped with 1 of the following `[optional category label]`:"

```
This model can be equipped with 1 of the following Primary Melee Weapons:
  Chainsword
  Power Sword
  Power Fist
```

The optional category label (e.g. "Primary Melee Weapons", "Secondary Ranged weapons") appears in some instances and not others.

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: null`.

---

### 4. additive-any *(common)*

**Pattern:** "This model can be equipped with any of the following:"

```
This model can be equipped with any of the following:
  Frag Grenades
  Krak Grenades
  Smoke Grenades
```

Also: "Every model can be equipped with any of the following:"

**Schema mapping:** `wargearOptions` entry with `maxSelections: null` (unlimited), `replaces: null`.

---

### 5. additive-single-direct *(frequent for wargear items)*

**Pattern:** "This model can be equipped with `[single item]`." (no list follows)

```
This model can be equipped with Artificer Armour.
This model can be equipped with a Cavalry Mount.
This model can be equipped with Frag Grenades and Krak Grenades.
```

The last variant names two items on one line joined by "and". Treat each as a separate additive-single rather than a list.

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: null`, `options: [{weaponName}]`.

---

### 6. modifier-flag *(appears once or twice per faction)*

**Pattern:** "Any weapon equipped by this model can be upgraded to a `[modifier name]`."

```
Any weapon equipped by this model can be upgraded to a Relic Weapon.
```

This is categorically different — it modifies a weapon already selected rather than adding a new item or replacing something. Relic Weapon (Astra Militarum: 8pts, Adeptus Astartes: 10pts, Adeptus Ministorum: 10pts, Adeptus Custodes: 15pts, Chaos Undivided: 10pts "Accursed") appears in every faction with different names and costs.

**Schema mapping:** `weaponModifiers` array entry; not a `wargearOptions` entry.

---

### 7. per-model-count-replace *(frequent in multi-model units)*

**Pattern:** "[N/Up to N/The] `[model type]` can replace their/its `[weapon]` with 1 of the following:"

```
Up to 2 Veterans in the unit can replace their Lasrifle with 1 of the following:
1 Intercessor can replace its Primary Ranged weapon with 1 of the following:
The Intercessor Sergeant can replace its Primary Ranged weapon with 1 of the following:
```

The "The `[Sergeant/model type]`" form limits to a named model role (usually 1 per unit).

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: [weaponName]`, `perModelLimit: N`.

---

### 8. ratio-based-replace *(Astra Militarum infantry, some other factions)*

**Pattern:** "For every `[X]` models in the unit, up to `[N]` `[model type]` can replace their `[weapon]` with 1 of the following:"

```
For every 10 models in the unit, up to 2 Guardsmen can replace their Lasrifle with 1 of the following:
For every 5 models in the unit, 1 Rough Rider can replace its Hunting Lance with 1 of the following:
```

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: [weaponName]`, `perXModels: X`, `perModelLimit: N`.

---

### 9. per-model-count-additive *(common — one-of-a-kind items)*

**Pattern:** "[N] `[model type]` [equipped with Standard Wargear] can be equipped with `[item]`."

```
1 Veteran equipped with Standard Wargear can be equipped with a Medi-kit
1 Veteran equipped with Standard Wargear can be equipped with a Regimental Standard
1 model in this unit can be equipped with a Chapter Banner.
```

The "equipped with Standard Wargear" qualifier appears in several instances and means "this slot must go to a model that hasn't taken other wargear upgrades". Cannot be parsed into a machine-enforceable constraint easily; flag in notes.

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: null`, `perModelLimit: 1`, `options: [{weaponName}]`.

---

### 10. ratio-based-additive *(Astra Militarum infantry)*

**Pattern:** "For every `[X]` models in the unit, `[N]` `[model type]` [qualifier] can be equipped with `[item]`."

```
For every 10 models in the unit, 1 Guardsmen equipped with Standard Wargear can be equipped with a Vox Caster.
For every 10 models in the unit, 1 Guardsmen equipped with Standard Wargear can be equipped with a Medi-kit.
```

**Schema mapping:** `wargearOptions` entry with `maxSelections: 1`, `replaces: null`, `perXModels: X`, `perModelLimit: 1`, `options: [{weaponName}]`.

---

### 11. multi-slot-replace *(Astra Militarum, Adeptus Astartes characters — moderate frequency)*

**Pattern:** "This model can replace its `[weapon]` with 1 `[type]` and 1 `[type]` from the following list:"

```
This model can replace its Lasrifle with 1 Pistol and 1 Melee weapon from the following list:
  Laspistol
  Autopistol
  Bolt Pistol
  Chainsword
  Power Sword
  Power Fist
```

This replaces one item with **two** items selected from the same combined list, where the first must be a Pistol and the second must be a Melee weapon. The list is not separated by type — both types appear interleaved. This is one of the most complex patterns and does not fit cleanly into the base schema. **Flag as requiring special handling.**

---

### 12. alternatively *(modifier clause, Astra Militarum and others)*

**Pattern:** "Alternatively, `[another option pattern]`"

Used as an inline alternative that modifies the immediately preceding option block:

```
Any Sergeant can replace its Lasrifle with 1 Boltgun or 1 Autogun. 
Alternatively, any Sergeant can replace its Lasrifle with 1 Pistol and 1 Melee weapon from the following list:
```

```
Alternatively, for every 10 models in the unit, 2 Guardsmen can form a Heavy Weapons Team...
```

**Schema mapping:** Treat as a separate `wargearOptions` entry. The "alternatively" clause is a sentence-level modifier, not a distinct top-level pattern.

---

### 13. heavy-weapons-team *(Astra Militarum only — rare but structurally unique)*

**Pattern:** "For every `[X]` models in the unit, `[N]` `[model type]` can form a Heavy Weapons Team equipped with 1 `[weapon]` and 1 of the following options:"

```
For every 10 models in the unit, 2 Guardsmen can form a Heavy Weapons Team equipped with 1 Lasrifle and 1 of the following options:
  1x Heavy Autogun
  ...
```

This simultaneously:
- Removes 2 models from the unit (merges them into a team)
- Grants the team a fixed weapon (Lasrifle) and a choice from the list
- The "1x" prefix appears before some weapon names

This pattern is structurally unique to Astra Militarum and cannot be expressed in the base schema without special-casing. **Flag as unrepresentable in Phase 1A schema; capture the description text and mark `requiresManualReview: true`.**

---

### 14. replace-double-pick *(Ogryn only — one instance)*

**Pattern:** "Any model can replace its `[weapon]` with 1 `[item]` or 1 `[item]`, and 1 `[item]` or 1 `[item]`"

```
Any model can replace its Ripper Gun with 1 Grenadier Gauntlet or 1 Ogryn Maul, and 1 Brute Shield or 1 Slab Shield
```

Replaces one weapon with **two** items (one from pair A and one from pair B). Not a list follows — the entire option is inline.

**Schema mapping:** This is a one-off. Capture as a `wargearOptions` entry with `requiresManualReview: true` and the raw `description` text preserved.

---

### 15. conditional *(rare — 1-2 instances across all factions)*

**Pattern:** "If `[condition]`, `[model]` can be equipped with `[item]`."

```
If an Intercessor's only Ranged weapon(s) have the Pistol keyword, it can be equipped with a Chainsword.
```

**Schema mapping:** Capture as `wargearOptions` entry with `condition` string and `requiresManualReview: true`.

---

### 16. ambiguous one-offs *(flag for manual review)*

The following single-occurrence patterns don't fit any canonical type cleanly:

- `"This model can replace its 2x Twin-linked Storm Bolter with 2x Grenade Launcher."` — quantity prefix on both sides
- `"This model can be equipped with up to 2x Hunter-Killer Missile."` — quantity-capped additive
- `"** When this model is equipped with a matching pair of these options..."` — footnote/clarification text (ignore; not a wargear option)
- Helstalker (Chaos Undivided): nested "1 of the following must be selected when equipped with a Helstalker" — multi-group mandatory picks within a single upgrade

---

## Faction-Level Wargear Upgrades (H3 Section)

These are parsed separately into `src/data/faction-wargear/{slug}.json`. Structure in the document:

```
[Item Name]\t[Points cost]
[Effect bullet 1]
[Effect bullet 2]
...
```

Key sub-types within faction-level upgrades:
- **Armour types** (Adeptus Astartes, Chaos Undivided): stat deltas + keyword additions/removals
- **Equipment items** (all factions): flat stat bonuses / ability grants
- **Weapon modifiers** (Relic Weapon, Accursed, Master-Crafted, Twin-linked): cost-per-weapon, apply to equipped weapons
- **Vehicle upgrades** (Dozer Blade, Smoke Launchers, Ion Shield etc.): stat bonuses specific to vehicles

The **Relic Weapon / Accursed / Master-Crafted** items appear in every faction under different names and with different point costs. These map to `weaponModifiers` in the per-unit schema.

The **Twin-linked** upgrade has a variable cost formula (not a flat number), computed from the equipped weapon's base points and Strength. This cannot be represented as a simple `pointsCost` integer.

---

## Phrasing Style Reference (Authoring Recommendations)

For future rules authoring, the following standardised phrasings are recommended for each canonical type:

| Pattern | Recommended Standard Phrasing |
|---|---|
| replace-one-of | "This model can replace its `[weapon]` with 1 of the following:" |
| additive-pick-one | "This model can be equipped with 1 of the following:" |
| additive-any | "This model can be equipped with any of the following:" |
| additive-single | "This model can be equipped with `[item]`." |
| modifier-flag | "Any weapon equipped by this model can be upgraded to a `[modifier]`." |
| unit-wide-replace | "Every model in the unit can replace its `[weapon]` with 1 of the following:" |
| unit-wide-pick-one | "Every model in the unit can be equipped with 1 of the following:" |
| unit-wide-any | "Every model in the unit can be equipped with any of the following:" |
| per-model-count-replace | "Up to `[N]` `[model type]` in the unit can replace their `[weapon]` with 1 of the following:" |
| per-model-count-additive | "Up to `[N]` `[model type]` in the unit can be equipped with 1 of the following:" |
| ratio-based-replace | "For every `[X]` models in the unit, up to `[N]` models can replace their `[weapon]` with 1 of the following:" |
| ratio-based-additive | "For every `[X]` models in the unit, up to `[N]` models can be equipped with 1 of the following:" |

**Avoid:** "Alternatively" clauses (parse ambiguously); multi-slot replacements ("1 Pistol and 1 Melee from the following list"); Heavy Weapons Team formation pattern (not representable in standard schema); inline "or" pairs without a list.

**Heading standardisation:** Standardise all per-unit option H6 headings to **"Wargear Options"** across all factions. Retire "Weapon Options", "Wargear Upgrades" and "Armour Options" as unit-profile sub-headings (the counts are: Weapon Options 19, Wargear Upgrades 60, Armour Options 10 — enough to be worth standardising).

---

## Summary Counts

| Canonical Type | Approx. Count | Notes |
|---|---|---|
| replace-one-of | ~200+ | Dominant pattern |
| additive-pick-one | ~80 | Common |
| additive-any | ~100 | Common |
| additive-single | ~80 | Common |
| modifier-flag | ~16 | Once per faction, Relic Weapon variants |
| unit-wide-replace | ~50 | Infantry units |
| unit-wide-pick-one | ~30 | Infantry units |
| unit-wide-any | ~40 | Infantry units |
| per-model-count-replace | ~40 | Multi-model units |
| per-model-count-additive | ~30 | Multi-model units |
| ratio-based-replace | ~15 | AM infantry mainly |
| ratio-based-additive | ~8 | AM infantry |
| multi-slot-replace | ~20 | AM + AA characters |
| alternatively | ~10 | Modifier clause |
| heavy-weapons-team | ~3 | AM only — cannot be represented in base schema |
| replace-double-pick | 1 | Ogryn only — cannot be represented in base schema |
| conditional | ~2 | Rare |
| ambiguous one-offs | ~5 | Footnote text, quantity-prefixed patterns |

**Items requiring manual review / special casing before scripting:**
1. Heavy Weapons Team (Astra Militarum infantry) — formation pattern
2. Replace-double-pick (Ogryn) — two-item replacement
3. Multi-slot-replace — two-pick from single mixed list
4. Twin-linked upgrade — variable cost formula, not a flat integer
5. Squadron Commander Standard Wargear — conditional mounting mechanic
