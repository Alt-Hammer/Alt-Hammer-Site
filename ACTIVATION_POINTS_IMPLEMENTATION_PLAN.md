# Implementation Plan: Activation Points Data Integration

## Overview
Add support for the new **Activation Points** characteristic to the Alt-Hammer website. This data will be extracted from the source Excel file and displayed on unit profile cards across all faction pages.

---

## Current State Analysis

### Excel File Structure (Verified)
**File**: `Alt-Hammer 40,000 1st Edition - Unit Data Tables by Faction.xlsx`

**New Column Layout** (0-based indices):
```
Col 0:  [Row identifier/empty]
Col 1:  Unit Name
Col 2:  Model Name
Col 3:  Activation Points ← NEW COLUMN
Col 4:  Movement
Col 5:  Weapon Skill
Col 6:  Ballistic Skill
Col 7:  Initiative
Col 8:  Attacks
Col 9:  Strength
Col 10: Toughness
Col 11: Wounds
Col 12: Save
Col 13: Leadership
Col 14: Base Points per Model
Col 15: Squad Sizes
Col 16: Keywords
```

**Impact**: All stat columns after "Activation Points" have shifted by +1 position.

### Current Python Script (`convert_units.py`)
- **Column Indices** (lines 98-115): Define positions of each stat
- **parse_stats() Function** (lines 123-135): Extracts stats into Python dict
- **Output JSON**: Each unit has a `stats` object with M, WS, BS, I, A, S, T, W, SV, LD, basePoints, squadSizes

**Example Current Output**:
```json
{
  "name": "Captain",
  "stats": {
    "M": "3\"",
    "WS": 6,
    "BS": 7,
    "I": 7,
    "A": 6,
    "S": 6,
    "T": 4,
    "W": 4,
    "SV": "5",
    "LD": "3+",
    "basePoints": 130,
    "squadSizes": "1"
  }
}
```

### Current Faction Page Display (`src/pages/factions/[slug].astro`)
- **STATS Array** (line 84): Hardcoded list of stat keys: `['M','WS','BS','I','A','S','T','W','SV','LD']`
- **buildStatline() Function** (lines 86-178): Creates HTML stat cards by iterating over STATS array
- **Stat Row HTML**: Each stat rendered as a grid cell with label and value

---

## Implementation Tasks

### ✅ Task 1: Update Python Script Column Indices
**File**: `scripts/convert_units.py`

**Changes Required**:
1. Add new constant after line 98:
   ```python
   COL_AP         = 3  # Activation Points (NEW)
   ```

2. Update all existing column index constants (increment by 1):
   ```python
   COL_M          = 4  # (was 3)
   COL_WS         = 5  # (was 4)
   COL_BS         = 6  # (was 5)
   COL_I          = 7  # (was 6)
   COL_A          = 8  # (was 7)
   COL_S          = 9  # (was 8)
   COL_T          = 10 # (was 9)
   COL_W          = 11 # (was 10)
   COL_SV         = 12 # (was 11)
   COL_LD         = 13 # (was 12)
   COL_PTS        = 14 # (was 13)
   COL_SIZES      = 15 # (was 14)
   COL_KEYWORDS   = 16 # (was 15)
   ```

3. Update **parse_stats() function** (lines 123-135) to include Activation Points:
   ```python
   def parse_stats(row) -> dict:
       return {
           'AP':         clean_str(cell_val(row, COL_AP,     '')),  # NEW
           'M':          clean_str(cell_val(row, COL_M,      '')),
           'WS':         cell_val(row, COL_WS,    None),
           'BS':         cell_val(row, COL_BS,    None),
           'I':          cell_val(row, COL_I,     None),
           'A':          cell_val(row, COL_A,     None),
           'S':          cell_val(row, COL_S,     None),
           'T':          cell_val(row, COL_T,     None),
           'W':          cell_val(row, COL_W,     None),
           'SV':         clean_str(cell_val(row, COL_SV,     '')),
           'LD':         clean_str(cell_val(row, COL_LD,     '')),
           'basePoints': cell_val(row, COL_PTS,   None),
           'squadSizes': clean_str(cell_val(row, COL_SIZES,  '')),
       }
   ```

4. Update docstring (lines 17-31) to reflect new column layout:
   ```python
   Column layout (0-based indices):
     1  Unit Name
     2  Model Name
     3  Activation Points
     4  Movement
     5  Weapon Skill
     6  Ballistic Skill
     7  Initiative
     8  Attacks
     9  Strength
     10 Toughness
     11 Wounds
     12 Save
     13 Leadership
     14 Base Points per Model
     15 Squad Sizes
     16 Keywords
   ```

**Validation**:
- Run: `python scripts/run_all.py` or `python scripts/convert_units.py`
- Check output: `src/data/units/*.json` files should now include `"AP"` key in each unit's stats
- Verify all 17+ factions processed correctly

---

### ✅ Task 2: Update Faction Page Display Script
**File**: `src/pages/factions/[slug].astro`

**Changes Required**:
1. Update **STATS Array** (line 84):
   ```javascript
   const STATS = ['AP','M','WS','BS','I','A','S','T','W','SV','LD'];
   ```

**Note**: `AP` is positioned first (before M, WS, BS, etc.) for logical display order consistent with game rules.

**Impact Areas**:
- Single-model unit stat row (lines 165-170)
- Multi-model unit stat rows (lines 131-138)
- Weapon profile stat rows (line 364) — **No change needed** (uses WPN_STATS, not STATS)

**Validation**:
- Visit any faction page (e.g., `/factions/adeptus-astartes`)
- Verify unit profile cards show new "AP" stat before other characteristics
- Verify multi-model units display AP for each model variant

---

### Task 3: CSS Styling (Optional Enhancement)
**Files**: 
- `src/styles/global.css`
- `public/styles/global.css` (build output)

**Current State**: Stat cells use grid layout with auto-sizing; no specific styling per stat type.

**Options**:
- **Option A (No Change)**: AP displays with same styling as other stats (simplest)
- **Option B (Highlight)**: Add specific styling to emphasize AP stat
  ```css
  .up-stat-cell[data-stat="AP"] {
    background-color: var(--color-surface-3);
    border-left: 2px solid var(--color-gold);
  }
  ```
- **Option C (Resize)**: Make AP cell slightly wider to accommodate any values
  ```css
  .up-stat-row {
    grid-template-columns: 1.2fr repeat(10, 1fr);  /* First column 1.2x wide */
  }
  ```

**Recommendation**: Option A (no changes) for initial implementation. Can revisit if UX testing suggests AP needs emphasis.

---

## Testing Checklist

### Python Script Testing
- [ ] Run `python scripts/convert_units.py` without errors
- [ ] Inspect output JSON file: `src/data/units/adeptus-astartes.json`
- [ ] Verify all units have `"AP"` key in stats object
- [ ] Verify all stat values are present (no null/missing fields from column shift)
- [ ] Verify no data corruption in other stat fields after column shift
- [ ] Run full pipeline: `python scripts/run_all.py` (all scripts execute)

### Website Display Testing
- [ ] Build site: `npm run build`
- [ ] Verify no TypeScript/JavaScript errors in build output
- [ ] Visit faction page: `http://localhost:3000/factions/adeptus-astartes` (after dev server)
- [ ] Verify unit profile cards render correctly
- [ ] Verify AP stat appears in correct position (first in stat row)
- [ ] Verify AP values display for all units
- [ ] Test multi-model units (e.g., Crisis Team) — AP shows per model
- [ ] Test responsive layout (mobile view) — AP stat is readable
- [ ] Test keyword functionality still works
- [ ] Spot-check 3+ different factions for consistency

### Regression Testing
- [ ] Other stats (M, WS, BS, etc.) still display correctly
- [ ] Unit names, categories, keywords unchanged
- [ ] Points and squad sizes still correct
- [ ] Weapon profiles unaffected (separate data, separate STATS array)
- [ ] List builder functionality unaffected (if it uses this data)

---

## Data Flow Diagram

```
Excel Source File
↓ (new column: Activation Points at index 3)
│
convert_units.py
├─ Read Excel rows starting at row 6
├─ Parse stats: COL_AP = 3, all others +1
├─ Include AP in parse_stats() dict
└─ Output JSON with "AP" key
    │
    ↓
src/data/units/*.json
├─ faction: "..."
├─ slug: "..."
├─ units[]
│   ├─ name: "..."
│   ├─ stats: {
│   │   "AP": "2",        ← NEW
│   │   "M": "3\"",
│   │   "WS": 6,
│   │   ...
│   ├─ keywords: [...]
│   └─ models: null or [...]
│
↓ (consumed by faction page)
│
src/pages/factions/[slug].astro
├─ Import unit JSON
├─ Pass unitMap to script
├─ STATS = ['AP','M','WS','BS','I','A','S','T','W','SV','LD']  ← UPDATED
├─ buildStatline() iterates STATS array
└─ Render stat grid: each key from stats object
    │
    ↓
Browser Display
└─ Unit profile cards with AP stat visible
```

---

## Files Modified

| File | Change Type | Lines | Description |
|------|------------|-------|-------------|
| `scripts/convert_units.py` | Code | 17-31, 98-115, 123-135 | Add COL_AP, update all column indices, update parse_stats(), update docstring |
| `src/pages/factions/[slug].astro` | Code | 84 | Update STATS array to include 'AP' as first stat |

---

## Rollback Plan (if needed)

1. **Python Script**: Revert column indices to original values (decrement by 1 for all stats after movement)
2. **Faction Page**: Remove 'AP' from STATS array
3. **Delete Generated Files**: Run `python scripts/convert_units.py` to regenerate JSON without AP
4. **Rebuild Site**: `npm run build`

---

## Notes

- **Backward Compatibility**: Existing JSON files will be regenerated; no migration needed
- **Other Scripts**: `convert_weapons.py`, `convert_factions.py`, etc. operate on separate data and are unaffected
- **Database**: No database changes required (site uses static JSON)
- **User Data**: No user-generated data affected
- **Future Maintenance**: If Excel columns shift again, only `convert_units.py` indices need updating; faction page STATS array remains in desired display order

---

## Success Criteria

✅ **All criteria must be met before marking implementation complete**:
1. convert_units.py runs without errors and produces JSON with AP field
2. All unit JSON files contain AP values (no missing/null values)
3. Faction pages display AP stat in all unit profile cards
4. All other stats remain correct (no data loss from column shift)
5. No new TypeScript/JavaScript errors in build
6. Responsive design maintains readability with new stat
7. All existing functionality (keywords, multi-model units, weapons) works correctly
