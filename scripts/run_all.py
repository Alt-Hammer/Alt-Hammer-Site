"""
run_all.py
──────────
Master script for the Alt-Hammer document conversion pipeline.
Double-click this file (or run it from the terminal) to convert
all three source documents in one go.

WHAT IT CONVERTS
────────────────
1. Core Rules .docx   →  src/content/rules/*.mdx
2. Faction Index .docx →  src/content/factions/*.mdx  
3. Datatables .xlsx    →  src/data/units/*.json

USAGE
─────
Option A — Double-click this file in Windows Explorer
Option B — From the VS Code terminal (in the alt-hammer-site folder):
           python scripts/run_all.py

AFTER RUNNING
─────────────
1. Check the terminal output for any errors (lines starting with ✗)
2. Preview the site locally: npm run dev
3. If everything looks good: git add . && git commit -m "Update content" && git push
"""

import sys
import os
import time

# Add scripts folder to path
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)


def print_banner():
    print("\n" + "=" * 60)
    print("  ALT-HAMMER 40,000 — CONTENT CONVERSION PIPELINE")
    print("=" * 60)
    print(f"  Running from: {os.getcwd()}")
    print("=" * 60 + "\n")


def check_working_directory():
    """
    Ensure the script is being run from inside the alt-hammer-site folder.
    We check for the presence of astro.config.mjs as confirmation.
    """
    if not os.path.exists('astro.config.mjs'):
        print("  ✗  ERROR: This script must be run from inside the")
        print("     alt-hammer-site folder.")
        print()
        print("  In VS Code terminal, make sure you are in:")
        print(r"  C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer Website\alt-hammer-site")
        print()
        print("  Then run:  python scripts/run_all.py")
        sys.exit(1)


def run_step(name: str, func, *args):
    """Run a conversion step and report success or failure."""
    print(f"\n{'─'*60}")
    print(f"  STEP: {name}")
    print(f"{'─'*60}")
    start = time.time()
    try:
        func(*args)
        elapsed = time.time() - start
        print(f"  ✓  {name} completed in {elapsed:.1f}s")
        return True
    except SystemExit:
        raise  # let sys.exit() propagate
    except Exception as e:
        print(f"\n  ✗  ERROR in {name}:")
        print(f"     {type(e).__name__}: {e}")
        print(f"\n  This step failed but continuing with remaining steps...")
        return False


def main():
    print_banner()
    check_working_directory()

    # Import conversion functions
    from convert_rules    import convert_rules,    CORE_RULES_DOCX,    OUTPUT_DIR as RULES_OUT
    from convert_factions import convert_factions, FACTION_INDEX_DOCX, OUTPUT_DIR as FACTIONS_OUT
    from convert_units    import convert_units,    DATATABLES_XLSX,    OUTPUT_DIR as UNITS_OUT
    from extract_definitions import extract_definitions, CORE_RULES_DOCX as DEFS_DOCX, OUTPUT_PATH as DEFS_OUT

    results = []

    # ── Step 0: Extract Keyword & Action definitions ───────────────────────────
    import json, os

    def _extract_and_write_defs(docx_path, out_path):
        defs_list = extract_definitions(docx_path)
        definitions = {}
        for entry in defs_list:
            if entry['slug'] not in definitions:
                definitions[entry['slug']] = {
                    'name': entry['name'],
                    'type': entry['type'],
                    'body': entry['body'],
                }
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(definitions, f, indent=2, ensure_ascii=False)
        print(f"  ✓  Written: {out_path} ({len(definitions)} definitions)")

    results.append(run_step(
        "Definitions → src/data/definitions.json",
        _extract_and_write_defs,
        DEFS_DOCX,
        DEFS_OUT,
    ))

    # ── Step 1: Core Rules ────────────────────────────────────────────────────
    results.append(run_step(
        "Core Rules → src/content/rules/",
        convert_rules,
        CORE_RULES_DOCX,
        RULES_OUT,
    ))

    # ── Step 2: Faction Rules ─────────────────────────────────────────────────
    results.append(run_step(
        "Faction Index → src/content/factions/",
        convert_factions,
        FACTION_INDEX_DOCX,
        FACTIONS_OUT,
    ))

    # ── Step 3: Unit Datatables ───────────────────────────────────────────────
    results.append(run_step(
        "Datatables → src/data/units/",
        convert_units,
        DATATABLES_XLSX,
        UNITS_OUT,
    ))

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETE")
    print(f"{'='*60}")

    steps = ["Definitions", "Core Rules", "Faction Index", "Unit Datatables"]
    all_ok = True
    for step, result in zip(steps, results):
        icon = "✓" if result else "✗"
        status = "OK" if result else "FAILED"
        print(f"  {icon}  {step}: {status}")
        if not result:
            all_ok = False

    if all_ok:
        print(f"\n  All conversions successful.")
        print(f"  Next steps:")
        print(f"    1. npm run dev          (preview locally)")
        print(f"    2. git add .")
        print(f"    3. git commit -m \"Update content from source documents\"")
        print(f"    4. git push             (Netlify rebuilds automatically)")
    else:
        print(f"\n  Some steps failed — check the errors above.")
        print(f"  Fix the issues and run this script again.")

    print(f"{'='*60}\n")

    # Keep terminal window open if double-clicked from Explorer
    if sys.stdout.isatty():
        input("  Press Enter to close...")


if __name__ == '__main__':
    main()
