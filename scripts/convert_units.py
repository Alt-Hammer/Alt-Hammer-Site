"""
convert_units.py
────────────────
Converts the Alt-Hammer Unit Data Tables Excel file (.xlsx) into JSON
files for the website's unit stat blocks and list builder.

SOURCE FILE
───────────
Alt-Hammer 40,000 1st Edition - Unit Data Tables by Faction.xlsx
  One sheet per faction, starting at row 6 (row 4 = headers, row 5 = blank).
  Column layout (0-based indices):
    1  Unit Name
    2  Model Name
    3  Movement
    4  Weapon Skill
    5  Ballistic Skill
    6  Initiative
    7  Attacks
    8  Strength
    9  Toughness
    10 Wounds
    11 Save
    12 Leadership
    13 Base Points per Model
    14 Squad Sizes
    15 Keywords

UNIT CATEGORIES
───────────────
Category labels (Character, Battleline, Infantry, etc.) appear as rows
where Unit Name is populated but Model Name and all stat columns are empty.
These are used to set the category for subsequent unit rows.

MULTI-MODEL UNITS
─────────────────
When consecutive rows share the same Unit Name but have different Model Names,
they are grouped under one parent unit entry with a 'models' array. The first
row's stats become the parent's stats (used for squad-level display); each
row produces a model entry with its own stat line.

OUTPUT
──────
  src/data/units/adeptus-astartes.json
  src/data/units/chaos-undivided.json
  ... etc. (one file per faction sheet)

JSON structure matches what [slug].astro consumes — see adeptus-astartes.json
for the canonical reference. The 'weapons' key is written as an empty array
by this script; convert_weapons.py populates it in a second pass.
"""

import sys
import os
import json

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

import openpyxl
from ah_converter_utils import slugify, ensure_dir

# ── Path configuration ────────────────────────────────────────────────────────

UNIT_DATATABLES_XLSX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Unit Data Tables by Faction.xlsx"

OUTPUT_DIR = "src/data/units"

# ── Sheets to skip ────────────────────────────────────────────────────────────

NON_FACTION_SHEETS = {'Hit Roll Table', 'Wound Roll Table', 'Hit Roll', 'Wound Roll'}

# ── Category labels (rows where only Unit Name is populated) ──────────────────

CATEGORY_LABELS = {
    'character', 'characters',
    'battleline',
    'infantry',
    'mounted',
    'walkers', 'walker',
    'vehicles', 'vehicle',
    'dedicated transports', 'dedicated transport',
    'fortifications', 'fortification',
    'beasts', 'beast',
    'swarms', 'swarm',
    'monsters', 'monster',
    'epic heroes', 'epic hero',
    'units',
    'aircraft',
}

# Maps sheet names to explicit slugs where the tab name doesn't match the
# faction MDX slug produced by convert_factions.py
SHEET_SLUG_OVERRIDES = {
    "The T'au Empire": 'the-tau-empire',
}

# ── Column indices (0-based) ──────────────────────────────────────────────────

COL_UNIT_NAME  = 1
COL_MODEL_NAME = 2
COL_M          = 3
COL_WS         = 4
COL_BS         = 5
COL_I          = 6
COL_A          = 7
COL_S          = 8
COL_T          = 9
COL_W          = 10
COL_SV         = 11
COL_LD         = 12
COL_PTS        = 13
COL_SIZES      = 14
COL_KEYWORDS   = 15


# ── Helpers ───────────────────────────────────────────────────────────────────

def cell_val(row, col_idx, default=None):
    if col_idx < len(row):
        val = row[col_idx]
        if val is not None and str(val).strip():
            return val
    return default


def clean_str(val) -> str:
    if val is None:
        return ''
    return (str(val).strip()
        .replace('\u2018', "'").replace('\u2019', "'")
        .replace('\u201c', '"').replace('\u201d', '"')
    )


def parse_keywords(val) -> list:
    if not val:
        return []
    return [k.strip() for k in str(val).split(',') if k.strip()]


def is_category_label(unit_name: str, model_name: str, row) -> bool:
    """
    A row is a category label if:
      - unit_name is a known category keyword, AND
      - model_name is empty, AND
      - the Movement column (COL_M) is empty
    This avoids misidentifying real units whose name happens to match a label.
    """
    if unit_name.lower().strip() not in CATEGORY_LABELS:
        return False
    if model_name:
        return False
    if cell_val(row, COL_M) is not None:
        return False
    return True


def parse_stats(row) -> dict:
    return {
        'M':          clean_str(cell_val(row, COL_M,     '')),
        'WS':         cell_val(row, COL_WS,    None),
        'BS':         cell_val(row, COL_BS,    None),
        'I':          cell_val(row, COL_I,     None),
        'A':          cell_val(row, COL_A,     None),
        'S':          cell_val(row, COL_S,     None),
        'T':          cell_val(row, COL_T,     None),
        'W':          cell_val(row, COL_W,     None),
        'SV':         clean_str(cell_val(row, COL_SV,    '')),
        'LD':         clean_str(cell_val(row, COL_LD,    '')),
        'basePoints': cell_val(row, COL_PTS,   None),
        'squadSizes': clean_str(cell_val(row, COL_SIZES, '')),
    }


# ── Main conversion ───────────────────────────────────────────────────────────

def convert_units(xlsx_path: str, output_dir: str):
    print(f"\n{'='*60}")
    print(f"  Alt-Hammer — Converting Unit Data Tables")
    print(f"{'='*60}")
    print(f"  Source:  {xlsx_path}")
    print(f"  Output:  {output_dir}")
    print(f"{'='*60}\n")

    if not os.path.exists(xlsx_path):
        print(f"  ✗  ERROR: Source file not found:")
        print(f"     {xlsx_path}")
        sys.exit(1)

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    written = 0

    for sheet_name in wb.sheetnames:
        if sheet_name in NON_FACTION_SHEETS:
            print(f"  —  Skipping sheet: {sheet_name}")
            continue

        ws = wb[sheet_name]
        print(f"  Processing: {sheet_name}")

        current_category = 'Unknown'

        # ── Pass 1: collect raw unit rows ─────────────────────────────────
        # Each entry: { unit_name, model_name, category, stats, keywords }
        raw_rows = []

        for row in ws.iter_rows(min_row=6, values_only=True):
            unit_name_val = cell_val(row, COL_UNIT_NAME)
            unit_name = clean_str(unit_name_val) if unit_name_val else ''
            if not unit_name:
                continue

            model_name_val = cell_val(row, COL_MODEL_NAME)
            model_name = clean_str(model_name_val) if model_name_val else ''

            # Category header row: unit name is a label, no model, no movement
            if is_category_label(unit_name, model_name, row):
                current_category = unit_name.title()
                continue

            # Must have a Movement value to be a valid unit stat row
            if cell_val(row, COL_M) is None:
                continue

            raw_rows.append({
                'unit_name':  unit_name,
                'model_name': model_name,
                'category':   current_category,
                'stats':      parse_stats(row),
                'keywords':   parse_keywords(cell_val(row, COL_KEYWORDS)),
            })

        # ── Pass 2: group multi-model units ───────────────────────────────
        # Consecutive rows sharing the same unit_name are model variants.
        # Each group becomes one unit entry; if there's only one row in
        # the group, it's a single-model unit (models: null).
        units = []
        i = 0
        while i < len(raw_rows):
            row = raw_rows[i]
            unit_name = row['unit_name']

            # Collect all consecutive rows with the same unit name
            group = [row]
            j = i + 1
            while j < len(raw_rows) and raw_rows[j]['unit_name'] == unit_name:
                group.append(raw_rows[j])
                j += 1

            if len(group) == 1:
                # Single-model unit
                # Use model_name as the display name if it differs from unit_name
                # (e.g. Intercessors / Intercessor), otherwise use unit_name.
                units.append({
                    'name':     unit_name,
                    'category': row['category'],
                    'stats':    row['stats'],
                    'keywords': row['keywords'],
                    'models':   None,
                })
            else:
                # Multi-model unit — each row becomes a model entry
                models = [
                    {
                        'modelName': r['model_name'] or r['unit_name'],
                        'stats':     r['stats'],
                        'keywords':  r['keywords'],
                    }
                    for r in group
                ]
                units.append({
                    'name':     unit_name,
                    'category': group[0]['category'],
                    'stats':    None,          # no single stat line; use models[]
                    'keywords': group[0]['keywords'],
                    'models':   models,
                })

            i = j

        # ── Write JSON (weapons written by convert_weapons.py) ─────────────
        faction_slug = SHEET_SLUG_OVERRIDES.get(sheet_name, slugify(sheet_name))
        output_data = {
            'faction': sheet_name,
            'slug':    faction_slug,
            'units':   units,
            'weapons': [],     # populated by convert_weapons.py in next step
        }

        output_path = os.path.join(output_dir, f"{faction_slug}.json")
        ensure_dir(output_dir)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        print(f"    ✓  {faction_slug}.json  ({len(units)} units)")
        written += 1

    wb.close()

    print(f"\n{'='*60}")
    print(f"  Complete: {written} unit JSON files written")
    print(f"  Output directory: {output_dir}")
    print(f"  Run convert_weapons.py next to populate weapon data.")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else UNIT_DATATABLES_XLSX
    out_dir   = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_DIR
    convert_units(xlsx_path, out_dir)
