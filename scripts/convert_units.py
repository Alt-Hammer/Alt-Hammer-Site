"""
convert_units.py
────────────────
Converts the Alt-Hammer Unit and Weapon Datatables Excel file (.xlsx)
into JSON files for the website's unit stat blocks and list builder.

WHAT IT DOES
────────────
1. Reads each faction sheet in the Excel file
2. Extracts unit stat blocks (Movement, WS, BS, I, A, S, T, W, SV, LD)
3. Extracts weapon profiles (Range, A, S, AP, D, Keywords)
4. Structures everything into clean JSON
5. Writes one JSON file per faction into src/data/units/

OUTPUT FILES
────────────
  src/data/units/adeptus-astartes.json
  src/data/units/astra-militarum.json
  ... etc.

JSON STRUCTURE PER FILE
───────────────────────
{
  "faction": "Adeptus Astartes",
  "units": [
    {
      "name": "Captain",
      "category": "Character",
      "stats": {
        "M": "6\"", "WS": 7, "BS": 7, "I": 6,
        "A": 6, "S": 4, "T": 4, "W": 6,
        "SV": "3+", "LD": "3+",
        "basePoints": 130, "squadSizes": "1"
      },
      "keywords": ["Imperium", "Adeptus Astartes", "Infantry", "Character", "Leader"]
    }
  ],
  "weapons": [
    {
      "name": "Bolt Pistol",
      "points": 2,
      "range": "12\"",
      "attacks": "1",
      "strength": 4,
      "ap": -1,
      "damage": "2",
      "keywords": ["Pistol"],
      "availability": "Tacticus, Gravis, Phobos, Scouts, Jump Pack, Bike"
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
# These rows identify the start of a new unit category; they are not units.

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
}

WEAPON_SECTION_LABELS = {'ranged weapons', 'melee weapons', 'weapons', 'psychic weapons'}

# ── Column indices (0-based, matching your xlsx structure) ────────────────────
# Based on the earlier inspection of the file:
# Units: B=1, C=2(M), D=3(WS), E=4(BS), F=5(I), G=6(A), H=7(S), 
#        I=8(T), J=9(W), K=10(SV), L=11(LD), M=12(pts), N=13(sizes), O=14(keywords)
# Weapons: Q=16(name), R=17(pts), S=18(range), T=19(A), U=20(S), 
#          V=21(AP), W=22(D), X=23(keywords), Y=24(availability)

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
COL_WPN_AVAIL    = 24  # may not exist in all sheets


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
    return str(val).strip()


def parse_keywords(val) -> list[str]:
    """Split a comma-separated keywords string into a list."""
    if not val:
        return []
    return [k.strip() for k in str(val).split(',') if k.strip()]


def is_category_label(name: str) -> bool:
    """Return True if this cell value is a category header row, not a unit name."""
    return name.lower().strip() in CATEGORY_LABELS


def is_weapon_section_label(name: str) -> bool:
    """Return True if this is a weapon section header."""
    return name.lower().strip() in WEAPON_SECTION_LABELS


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
        print(f"\n  Please check the DATATABLES_XLSX path at the top of this script.")
        sys.exit(1)

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    written = 0

    for sheet_name in wb.sheetnames:
        if sheet_name in NON_FACTION_SHEETS:
            print(f"  —  Skipping sheet: {sheet_name}")
            continue

        ws = wb[sheet_name]
        print(f"  Processing: {sheet_name}")

        units = []
        weapons = []

        current_unit_category = 'Unknown'
        current_unit_name = None
        current_unit_row = None

        for row in ws.iter_rows(min_row=5, values_only=True):
            # ── Unit columns ──────────────────────────────────────────────
            unit_name_val = cell_val(row, COL_UNIT_NAME)
            unit_name = clean_str(unit_name_val) if unit_name_val else ''

            # ── Weapon columns ────────────────────────────────────────────
            wpn_name_val = cell_val(row, COL_WPN_NAME)
            wpn_name = clean_str(wpn_name_val) if wpn_name_val else ''

            # ── Detect category header rows ───────────────────────────────
            if unit_name and is_category_label(unit_name):
                current_unit_category = unit_name.title()
                current_unit_name = None
                continue

            if unit_name and is_weapon_section_label(unit_name):
                continue

            # ── Parse unit row ─────────────────────────────────────────────
            # A unit row has a name AND at least a Movement value
            movement_val = cell_val(row, COL_UNIT_M)
            if unit_name and movement_val is not None:
                current_unit_name = unit_name
                unit = {
                    'name': unit_name,
                    'category': current_unit_category,
                    'stats': {
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
                    },
                    'keywords': parse_keywords(cell_val(row, COL_UNIT_KEYWORDS)),
                }
                units.append(unit)

            # ── Parse weapon row ───────────────────────────────────────────
            # A weapon row has a name AND at least a range value
            wpn_range_val = cell_val(row, COL_WPN_RANGE)
            if wpn_name and not is_weapon_section_label(wpn_name):
                weapon = {
                    'name':         wpn_name,
                    'points':       cell_val(row, COL_WPN_PTS,      None),
                    'range':        clean_str(cell_val(row, COL_WPN_RANGE,    '')),
                    'attacks':      clean_str(cell_val(row, COL_WPN_A,        '')),
                    'strength':     cell_val(row, COL_WPN_S,       None),
                    'ap':           cell_val(row, COL_WPN_AP,      None),
                    'damage':       clean_str(cell_val(row, COL_WPN_D,        '')),
                    'keywords':     parse_keywords(cell_val(row, COL_WPN_KEYWORDS)),
                    'availability': clean_str(cell_val(row, COL_WPN_AVAIL,   '')),
                }
                # Only add if it has some meaningful data
                if weapon['range'] or weapon['attacks']:
                    weapons.append(weapon)

        # ── Write faction JSON file ────────────────────────────────────────

        faction_slug = slugify(sheet_name)
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
