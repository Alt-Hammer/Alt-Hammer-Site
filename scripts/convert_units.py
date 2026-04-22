"""
convert_units.py
────────────────
Converts the Alt-Hammer Unit and Weapon Datatables Excel file (.xlsx)
into JSON files for the website's unit stat blocks and list builder.

WHAT IT DOES
────────────
1. Reads each faction sheet in the Excel file
2. Extracts unit stat blocks (Movement, WS, BS, I, A, S, T, W, SV, LD)
3. Groups multi-model units (e.g. "Boys - Boy" / "Boys - Nob") into a
   single unit entry with a 'models' array containing each variant
4. Extracts weapon profiles (Range, A, S, AP, D, Keywords)
5. Structures everything into clean JSON
6. Writes one JSON file per faction into src/data/units/

OUTPUT FILES
────────────
  src/data/units/adeptus-astartes.json
  src/data/units/astra-militarum.json
  ... etc.

JSON STRUCTURE PER FILE
───────────────────────
Single-model unit:
{
  "name": "Captain",
  "category": "Character",
  "stats": { "M": "6\"", "WS": 7, ... "basePoints": 130, "squadSizes": "1" },
  "keywords": ["Imperium", "Adeptus Astartes", "Infantry", "Character", "Leader"],
  "models": null
}

Multi-model unit:
{
  "name": "Boys",
  "category": "Battleline",
  "stats": null,
  "keywords": ["Orks", "Infantry"],
  "models": [
    {
      "modelName": "Boy",
      "stats": { "M": "5\"", "WS": 4, ... "basePoints": 6, "squadSizes": "5 to 30" },
      "keywords": ["Orks", "Infantry"]
    },
    {
      "modelName": "Nob",
      "stats": { "M": "5\"", "WS": 5, ... "basePoints": 20, "squadSizes": "1" },
      "keywords": ["Orks", "Infantry"]
    }
  ]
}

HOW TO RUN
──────────
  python scripts/convert_units.py

Or double-click run_all.py to convert everything at once.
"""

import sys
import os
import re
import json

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

import openpyxl
from ah_converter_utils import slugify, write_json_file, ensure_dir

# ── Path configuration ────────────────────────────────────────────────────────

DATATABLES_XLSX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Unit and Weapon Datatables by Faction.xlsx"

OUTPUT_DIR = "src/data/units"

# ── Sheets to skip (not faction data) ────────────────────────────────────────

NON_FACTION_SHEETS = {'Hit Roll Table', 'Wound Roll Table', 'Hit Roll', 'Wound Roll'}

# ── Category labels that appear as section headers in the sheet ───────────────

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

WEAPON_SECTION_LABELS = {'ranged weapons', 'melee weapons', 'weapons', 'psychic attacks', 'grenades'}

# Maps sheet names to explicit slugs where the sheet name doesn't match
# the faction MDX slug produced by convert_factions.py
SHEET_SLUG_OVERRIDES = {
    "The T'au Empire": 'the-tau-empire',
}

# ── Column indices (0-based) ──────────────────────────────────────────────────

COL_UNIT_NAME     = 1
COL_UNIT_M        = 2
COL_UNIT_WS       = 3
COL_UNIT_BS       = 4
COL_UNIT_I        = 5
COL_UNIT_A        = 6
COL_UNIT_S        = 7
COL_UNIT_T        = 8
COL_UNIT_W        = 9
COL_UNIT_SV       = 10
COL_UNIT_LD       = 11
COL_UNIT_PTS      = 12
COL_UNIT_SIZES    = 13
COL_UNIT_KEYWORDS = 14

COL_WPN_NAME     = 16
COL_WPN_PTS      = 17
COL_WPN_RANGE    = 18
COL_WPN_A        = 19
COL_WPN_S        = 20
COL_WPN_AP       = 21
COL_WPN_D        = 22
COL_WPN_KEYWORDS = 23
COL_WPN_AVAIL    = 24


def cell_val(row: tuple, col_idx: int, default=None):
    """Safely get a cell value from a row tuple by column index."""
    if col_idx < len(row):
        val = row[col_idx]
        if val is not None and str(val).strip():
            return val
    return default


def clean_str(val) -> str:
    """Convert a cell value to a clean string."""
    if val is None:
        return ''
    s = str(val).strip()
    return (s
        .replace('\u2018', "'").replace('\u2019', "'")
        .replace('\u201c', '"').replace('\u201d', '"')
    )

def parse_keywords(val) -> list:
    """Split a comma-separated keywords string into a list."""
    if not val:
        return []
    return [k.strip() for k in str(val).split(',') if k.strip()]


def is_category_label(name: str) -> bool:
    return name.lower().strip() in CATEGORY_LABELS


def is_weapon_section_label(name: str) -> bool:
    return name.lower().strip() in WEAPON_SECTION_LABELS


def parse_stats(row: tuple) -> dict:
    """Extract the stats dict from a row."""
    return {
        'M':          clean_str(cell_val(row, COL_UNIT_M,    '')),
        'WS':         cell_val(row, COL_UNIT_WS,   None),
        'BS':         cell_val(row, COL_UNIT_BS,   None),
        'I':          cell_val(row, COL_UNIT_I,    None),
        'A':          cell_val(row, COL_UNIT_A,    None),
        'S':          cell_val(row, COL_UNIT_S,    None),
        'T':          cell_val(row, COL_UNIT_T,    None),
        'W':          cell_val(row, COL_UNIT_W,    None),
        'SV':         clean_str(cell_val(row, COL_UNIT_SV,   '')),
        'LD':         clean_str(cell_val(row, COL_UNIT_LD,   '')),
        'basePoints': cell_val(row, COL_UNIT_PTS,  None),
        'squadSizes': clean_str(cell_val(row, COL_UNIT_SIZES, '')),
    }


def split_variant_name(name: str):
    """
    Split a 'Unit Name - Model Variant' string into (base_name, variant_name).
    Returns (name, None) if no ' - ' separator is found.

    Examples:
      'Boys - Boy'              → ('Boys', 'Boy')
      'Boys - Nob'              → ('Boys', 'Nob')
      'Squighog Riderz - Nob on Smashasquig' → ('Squighog Riderz', 'Nob on Smashasquig')
      'Captain'                 → ('Captain', None)
    """
    if ' - ' in name:
        parts = name.split(' - ', 1)
        return parts[0].strip(), parts[1].strip()
    return name, None


def convert_units(xlsx_path: str, output_dir: str):
    print(f"\n{'='*60}")
    print(f"  Alt-Hammer — Converting Unit Datatables")
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

        # ── Pass 1: collect all raw unit rows ─────────────────────────────
        # Each raw row is: { name, category, stats, keywords }
        raw_units = []
        raw_weapons = []
        current_unit_category = 'Unknown'
        current_weapon_section = 'Weapons'

        for row in ws.iter_rows(min_row=5, values_only=True):
            unit_name_val = cell_val(row, COL_UNIT_NAME)
            unit_name = clean_str(unit_name_val) if unit_name_val else ''

            wpn_name_val = cell_val(row, COL_WPN_NAME)
            wpn_name = clean_str(wpn_name_val) if wpn_name_val else ''

            # Detect category header rows
            if unit_name and is_category_label(unit_name):
                current_unit_category = unit_name.title()
                continue

            if unit_name and is_weapon_section_label(unit_name):
                continue

            # Parse unit row — must have a name AND a Movement value
            movement_val = cell_val(row, COL_UNIT_M)
            if unit_name and movement_val is not None:
                raw_units.append({
                    'name':     unit_name,
                    'category': current_unit_category,
                    'stats':    parse_stats(row),
                    'keywords': parse_keywords(cell_val(row, COL_UNIT_KEYWORDS)),
                })

            # Detect weapon section header rows (Ranged Weapons, Melee Weapons, etc.)
            if wpn_name and is_weapon_section_label(wpn_name):
                current_weapon_section = wpn_name.strip()
                continue

            # Parse weapon row — must have a name AND at least range or attacks
            if wpn_name and wpn_name != 'Name':
                wpn_range = clean_str(cell_val(row, COL_WPN_RANGE, ''))
                wpn_attacks = clean_str(cell_val(row, COL_WPN_A, ''))
                if wpn_range or wpn_attacks:
                    raw_weapons.append({
                        'name':     wpn_name,
                        'section':  current_weapon_section,
                        'points':   cell_val(row, COL_WPN_PTS,      None),
                        'range':    wpn_range,
                        'attacks':  wpn_attacks,
                        'strength': cell_val(row, COL_WPN_S,       None),
                        'ap':       cell_val(row, COL_WPN_AP,      None),
                        'damage':   clean_str(cell_val(row, COL_WPN_D, '')),
                        'keywords': parse_keywords(cell_val(row, COL_WPN_KEYWORDS)),
                    })

        # ── Pass 2: group variant rows under parent unit entries ───────────
        #
        # Strategy:
        # - If a row name contains ' - ', it is a model variant.
        # - Extract base_name (before ' - ') and model_name (after ' - ').
        # - Find or create a parent unit entry with that base_name.
        # - Add the variant as an entry in the parent's 'models' list.
        # - If a standalone row exists with the same base_name (i.e. a plain
        #   'Boys' row alongside 'Boys - Boy' and 'Boys - Nob'), that row
        #   becomes the parent's own stats (unit-level stats), which may
        #   differ from the model variant stats.
        #
        # Result: each parent unit has:
        #   - stats: the unit-level stats row if present, else None
        #   - models: list of { modelName, stats, keywords } if variants exist

        # First pass: separate plain rows from variant rows
        plain_rows = []
        variant_rows = []
        for raw in raw_units:
            base_name, variant_name = split_variant_name(raw['name'])
            if variant_name is not None:
                variant_rows.append({
                    'baseName':    base_name,
                    'modelName':   variant_name,
                    'category':    raw['category'],
                    'stats':       raw['stats'],
                    'keywords':    raw['keywords'],
                })
            else:
                plain_rows.append(raw)

        # Build the units list, merging variants into parents
        units = []
        # Track which base names have variants so we can create parent entries
        variant_bases = {}
        for v in variant_rows:
            base = v['baseName']
            if base not in variant_bases:
                variant_bases[base] = []
            variant_bases[base].append(v)

        # Add all plain rows as unit entries
        # If a plain row shares a base name with variants, it becomes the parent
        added_bases = set()
        for raw in plain_rows:
            name = raw['name']
            if name in variant_bases:
                # This plain row is the parent of variant rows
                models = [
                    {
                        'modelName': v['modelName'],
                        'stats':     v['stats'],
                        'keywords':  v['keywords'],
                    }
                    for v in variant_bases[name]
                ]
                units.append({
                    'name':     name,
                    'category': raw['category'],
                    'stats':    raw['stats'],    # unit-level stats
                    'keywords': raw['keywords'],
                    'models':   models,
                })
                added_bases.add(name)
            else:
                # Standard single-model unit
                units.append({
                    'name':     name,
                    'category': raw['category'],
                    'stats':    raw['stats'],
                    'keywords': raw['keywords'],
                    'models':   None,
                })

        # Add variant-only groups where no plain parent row exists
        # (e.g. 'Boys - Boy' / 'Boys - Nob' with no plain 'Boys' row)
        for base_name, variants in variant_bases.items():
            if base_name in added_bases:
                continue
            # Use the first variant's category and keywords as the parent's
            models = [
                {
                    'modelName': v['modelName'],
                    'stats':     v['stats'],
                    'keywords':  v['keywords'],
                }
                for v in variants
            ]
            units.append({
                'name':     base_name,
                'category': variants[0]['category'],
                'stats':    None,   # no standalone unit-level stats row
                'keywords': variants[0]['keywords'],
                'models':   models,
            })

        # ── Pass 3: group weapon attack profiles under parent weapon entries ──
        #
        # Strategy mirrors the unit variant grouping:
        # - Rows named 'Plasma Gun - Standard' / 'Plasma Gun - Overcharged'
        #   are attack profiles. Extract base name and profile name.
        # - If multiple profiles share a base name, create a parent entry
        #   with a 'profiles' array.
        # - Single-profile weapons keep a flat structure (profiles: null).
        # - Weapons are grouped by their 'section' field for the index.

        plain_weapons = []
        profile_weapons = []
        for raw in raw_weapons:
            base_name, profile_name = split_variant_name(raw['name'])
            if profile_name is not None:
                profile_weapons.append({
                    'baseName':    base_name,
                    'profileName': profile_name,
                    'section':     raw['section'],
                    'points':      raw['points'],
                    'range':       raw['range'],
                    'attacks':     raw['attacks'],
                    'strength':    raw['strength'],
                    'ap':          raw['ap'],
                    'damage':      raw['damage'],
                    'keywords':    raw['keywords'],
                })
            else:
                plain_weapons.append(raw)

        # Build profile lookup
        profile_bases = {}
        for p in profile_weapons:
            base = p['baseName']
            if base not in profile_bases:
                profile_bases[base] = []
            profile_bases[base].append(p)

        weapons = []
        added_weapon_bases = set()

        for raw in plain_weapons:
            name = raw['name']
            if name in profile_bases:
                profiles = [
                    {
                        'profileName': p['profileName'],
                        'points':      p['points'],
                        'range':       p['range'],
                        'attacks':     p['attacks'],
                        'strength':    p['strength'],
                        'ap':          p['ap'],
                        'damage':      p['damage'],
                        'keywords':    p['keywords'],
                    }
                    for p in profile_bases[name]
                ]
                weapons.append({
                    'name':     name,
                    'section':  raw['section'],
                    'points':   raw['points'],
                    'profiles': profiles,
                    'range':    None,
                    'attacks':  None,
                    'strength': None,
                    'ap':       None,
                    'damage':   None,
                    'keywords': raw['keywords'],
                })
                added_weapon_bases.add(name)
            else:
                weapons.append({
                    'name':     name,
                    'section':  raw['section'],
                    'points':   raw['points'],
                    'profiles': None,
                    'range':    raw['range'],
                    'attacks':  raw['attacks'],
                    'strength': raw['strength'],
                    'ap':       raw['ap'],
                    'damage':   raw['damage'],
                    'keywords': raw['keywords'],
                })

        # Profile-only weapons (no plain parent row)
        for base_name, profiles in profile_bases.items():
            if base_name in added_weapon_bases:
                continue
            weapons.append({
                'name':     base_name,
                'section':  profiles[0]['section'],
                'points':   profiles[0]['points'],
                'profiles': [
                    {
                        'profileName': p['profileName'],
                        'points':      p['points'],
                        'range':       p['range'],
                        'attacks':     p['attacks'],
                        'strength':    p['strength'],
                        'ap':          p['ap'],
                        'damage':      p['damage'],
                        'keywords':    p['keywords'],
                    }
                    for p in profiles
                ],
                'range':    None,
                'attacks':  None,
                'strength': None,
                'ap':       None,
                'damage':   None,
                'keywords': profiles[0]['keywords'],
            })

        # ── Write faction JSON file ────────────────────────────────────────
        faction_slug = SHEET_SLUG_OVERRIDES.get(sheet_name, slugify(sheet_name))
        output_data = {
            'faction': sheet_name,
            'slug':    faction_slug,
            'units':   units,
            'weapons': weapons,
        }

        output_path = os.path.join(output_dir, f"{faction_slug}.json")
        write_json_file(output_path, output_data)
        written += 1

    wb.close()

    print(f"\n{'='*60}")
    print(f"  Complete: {written} faction JSON files written")
    print(f"  Output directory: {output_dir}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else DATATABLES_XLSX
    out_dir   = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_DIR

    convert_units(xlsx_path, out_dir)