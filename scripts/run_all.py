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
    from convert_rules       import convert_rules,    CORE_RULES_DOCX,        OUTPUT_DIR as RULES_OUT
    from convert_factions    import convert_factions, FACTION_INDEX_DOCX,     OUTPUT_DIR as FACTIONS_OUT
    from convert_units       import convert_units,    UNIT_DATATABLES_XLSX,   OUTPUT_DIR as UNITS_OUT
    from convert_weapons     import convert_weapons,  WEAPON_DATATABLES_XLSX, OUTPUT_DIR as WEAPONS_OUT
    from extract_definitions import extract_definitions, CORE_RULES_DOCX as DEFS_DOCX, OUTPUT_PATH as DEFS_OUT
    from extract_roll_tables import extract_roll_tables, ROLL_TABLES_XLSX
    from extract_stratagems  import extract_stratagems
    from extract_objectives  import extract_objectives

    results = []

    # ── Step 0: Extract Keyword & Action definitions ───────────────────────────
    import json, os

    def _extract_and_write_defs(docx_path, out_path):
        defs_list = extract_definitions(docx_path)
        definitions = {}
        for entry in defs_list:
            if entry['slug'] not in definitions:
                definition = {
                    'name': entry['name'],
                    'type': entry['type'],
                    'body': entry['body'],
                }
                if entry.get('cost'):
                    definition['cost'] = entry['cost']
                definitions[entry['slug']] = definition
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

    # ── Step 1a: Inject RollTable components into making-attacks.mdx ──────────
    # Must run after Step 1 (which creates the MDX file).
    # The converter outputs the Hit Roll and Wound Roll tables as HTML matrix
    # blocks. This step replaces them in document order with <RollTable />
    # component calls and adds the required import statements.
    def _inject_roll_tables(mdx_path):
        with open(mdx_path, 'r', encoding='utf-8') as f:
            content = f.read()

        roll_table_imports = (
            "import RollTable from '../../components/RollTable.astro';\n"
            "import hitData from '../../data/hit-roll-table.json';\n"
            "import woundData from '../../data/wound-roll-table.json';"
        )
        if 'import RollTable' not in content:
            frontmatter_end = content.find('\n---\n', 3)
            if frontmatter_end == -1:
                raise ValueError("Could not find frontmatter closing fence in making-attacks.mdx")
            insert_at = frontmatter_end + len('\n---\n')
            content = content[:insert_at] + roll_table_imports + '\n\n' + content[insert_at:]

        # The hit/wound roll tables live in the Excel file, not the Word doc, so
        # the converter produces no table HTML for them. Instead we use stable
        # text anchors to find the right insertion points.
        #
        # Hit roll table: insert before the follow-up paragraph that begins
        # "Hit rolls are often subject to positive or negative modifiers".
        hit_anchor = '\nHit rolls are often subject to positive or negative modifiers'
        hit_pos = content.find(hit_anchor)
        if hit_pos == -1:
            raise ValueError("Could not find hit-roll anchor paragraph in making-attacks.mdx")
        content = content[:hit_pos] + '\n\n<RollTable data={hitData} />' + content[hit_pos:]

        # Wound roll table: insert before the ### "Hit Them from Behind!" heading
        # that immediately follows the wound roll section.
        wound_anchor = '\n### "Hit Them from Behind!"'
        wound_pos = content.find(wound_anchor)
        if wound_pos == -1:
            raise ValueError('Could not find wound-roll anchor heading in making-attacks.mdx')
        content = content[:wound_pos] + '\n\n<RollTable data={woundData} />' + content[wound_pos:]

        with open(mdx_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  ✓  Injected RollTable components into {mdx_path}")

    results.append(run_step(
        "Inject RollTable → making-attacks.mdx",
        _inject_roll_tables,
        "src/content/rules/making-attacks.mdx",
    ))

    # ── Step 1b: Extract Roll Tables from Excel ───────────────────────────────
    # Reads the Hit Roll and Wound Roll tables from the Excel source file and
    # writes src/data/hit-roll-table.json and src/data/wound-roll-table.json.
    # These JSON files are consumed by RollTable.astro in making-attacks.mdx.
    # Runs independently of Step 1 — making-attacks.mdx is excluded from the
    # convert_rules.py output and maintained manually.
    results.append(run_step(
        "Roll Tables → src/data/hit-roll-table.json + wound-roll-table.json",
        extract_roll_tables,
        ROLL_TABLES_XLSX,
    ))

    # ── Step 1c: Extract Stratagems from Core Rules ────────────────────────────
    # Reads Stratagems from the Core Rules .docx and writes
    # src/data/stratagems.ts, consumed by StrategyGrid.astro.
    # Runs independently of Step 1 — command-points-stratagems.mdx is excluded
    # from convert_rules.py output and maintained manually.
    results.append(run_step(
        "Stratagems → src/data/stratagems.ts",
        extract_stratagems,
    ))

    # ── Step 1d: Extract Secondary Objectives from Core Rules ──────────────────
    # Reads Secondary Mission Objectives from the Core Rules .docx and writes
    # src/data/objectives.ts, consumed by ObjectiveGrid.astro.
    # Runs independently of Step 1 — generating-a-battle.mdx is now generated
    # by convert_rules.py and no longer post-processed for tab conversion.
    results.append(run_step(
        "Secondary Objectives → src/data/objectives.ts",
        extract_objectives,
    ))

    # ── Step 1e: Inject ObjectiveGrid into generating-a-battle.mdx ────────────
    # Must run after Step 1 (which creates the MDX file) and Step 1d (which
    # creates objectives.ts that the injected import references).
    # Replaces the raw H5/H6/H7 objectives content produced by the converter
    # with an <ObjectiveGrid /> component invocation, and adds the required
    # import statements.
    def _inject_objective_grid(mdx_path):
        with open(mdx_path, 'r', encoding='utf-8') as f:
            content = f.read()

        section_heading = '## Optional Game Feature: Secondary Mission Objectives'
        section_start = content.find(section_heading)
        if section_start == -1:
            raise ValueError("Could not find 'Secondary Mission Objectives' section in MDX")

        # Cut point: the first H5 theme heading (##### ...) after the section
        # heading. Everything from here to EOF is raw converter output that
        # ObjectiveGrid replaces.
        cut_marker = '\n##### '
        theme_start = content.find(cut_marker, section_start)
        if theme_start == -1:
            raise ValueError("Could not find theme headings (##### ...) in objectives section")

        new_content = content[:theme_start].rstrip()
        new_content += '\n\n<ObjectiveGrid objectives={SECONDARY_OBJECTIVES} />\n'

        objective_imports = (
            'import ObjectiveGrid from \'../../components/ObjectiveGrid.astro\';\n'
            'import { SECONDARY_OBJECTIVES } from \'../../data/objectives\';'
        )
        if 'import ObjectiveGrid' not in new_content:
            frontmatter_end = new_content.find('\n---\n', 3)
            if frontmatter_end == -1:
                raise ValueError("Could not find frontmatter closing fence in generated MDX")
            insert_at = frontmatter_end + len('\n---\n')
            new_content = new_content[:insert_at] + objective_imports + '\n\n' + new_content[insert_at:]

        with open(mdx_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  ✓  Injected ObjectiveGrid into {mdx_path}")

    results.append(run_step(
        "Inject ObjectiveGrid → generating-a-battle.mdx",
        _inject_objective_grid,
        "src/content/rules/generating-a-battle.mdx",
    ))

    # ── Step 1f: Wrap deployment zone layouts as accordions ───────────────────
    # Must run after Step 1e (which finalises generating-a-battle.mdx).
    # The converter marks each 'DZ Heading 7' paragraph with
    # class="deployment-layout-heading". This step replaces those <h7> tags
    # with <details class="deployment-layout"><summary>...</summary><img/></details>
    # blocks, injecting the correct image for each layout from a static mapping.
    # The image filenames follow the pattern {typology-slug}-{layout-number}.jpg
    # and correspond to files in public/images/.
    def _inject_deployment_accordions(mdx_path):
        import re

        # Flat ordered list of (filename, alt) in document order:
        # SE-1, SE-2, SE-3, FR-1, FR-2, FR-3, AB-1, AB-2, AB-3
        # Update this list if new typologies or layouts are ever added.
        IMAGES_IN_ORDER = [
            ('sweeping-engagement-1.jpg', 'Sweeping Engagement deployment zone layout 1'),
            ('sweeping-engagement-2.jpg', 'Sweeping Engagement deployment zone layout 2'),
            ('sweeping-engagement-3.jpg', 'Sweeping Engagement deployment zone layout 3'),
            ('force-recon-1.jpg',         'Force Recon deployment zone layout 1'),
            ('force-recon-2.jpg',         'Force Recon deployment zone layout 2'),
            ('force-recon-3.jpg',         'Force Recon deployment zone layout 3'),
            ('asymmetric-battle-1.jpg',   'Asymmetric Battle deployment zone layout 1'),
            ('asymmetric-battle-2.jpg',   'Asymmetric Battle deployment zone layout 2'),
            ('asymmetric-battle-3.jpg',   'Asymmetric Battle deployment zone layout 3'),
        ]

        with open(mdx_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # ── Phase 1: Normalise ────────────────────────────────────────────────
        # Strip any state left by a previous run or manual edit so Phase 2
        # always starts from the same clean baseline. This makes the function
        # idempotent regardless of what state the file was in beforehand.

        # 1a. Remove any standalone deployment <img> tags (orphaned images).
        known_filenames = '|'.join(
            re.escape(fname) for fname, _ in IMAGES_IN_ORDER
        )
        content = re.sub(
            rf'\n*<img src="/images/(?:{known_filenames})"[^/]*/?>',
            '',
            content,
        )

        # 1b. Unwrap any existing <details class="deployment-layout"> blocks
        #     back to bare <h7 class="deployment-layout-heading"> tags.
        content = re.sub(
            r'<details class="deployment-layout">\s*'
            r'<summary([^>]*)>(.*?)</summary>\s*'
            r'</details>',
            r'<h7 class="deployment-layout-heading"\1>\2</h7>',
            content,
            flags=re.DOTALL,
        )

        # ── Phase 2: Apply accordion wrapping ────────────────────────────────
        pattern = re.compile(
            r'<h7 class="deployment-layout-heading"([^>]*)>(.*?)</h7>',
            re.DOTALL,
        )

        matches = list(pattern.finditer(content))
        if len(matches) != 9:
            raise ValueError(
                f"Expected 9 deployment-layout-heading <h7> tags, found {len(matches)}. "
                "Check that all 9 Layout headings in the Word doc use the 'DZ Heading 7' style."
            )

        # Replace from last to first so earlier string positions remain valid.
        for i, match in reversed(list(enumerate(matches))):
            filename, alt_text = IMAGES_IN_ORDER[i]
            replacement = (
                f'<details class="deployment-layout">\n'
                f'  <summary{match.group(1)}>{match.group(2)}</summary>\n'
                f'  <img src="/images/{filename}" alt="{alt_text}" />\n'
                f'</details>'
            )
            content = content[:match.start()] + replacement + content[match.end():]

        with open(mdx_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  ✓  Wrapped 9 deployment layout accordions in {mdx_path}")

    results.append(run_step(
        "Inject deployment accordions → generating-a-battle.mdx",
        _inject_deployment_accordions,
        "src/content/rules/generating-a-battle.mdx",
    ))

    # ── Step 2: Faction Rules ─────────────────────────────────────────────────
    results.append(run_step(
        "Faction Index → src/content/factions/",
        convert_factions,
        FACTION_INDEX_DOCX,
        FACTIONS_OUT,
    ))

    # ── Step 3: Unit Data Tables ──────────────────────────────────────────────
    results.append(run_step(
        "Unit Data Tables → src/data/units/ (units)",
        convert_units,
        UNIT_DATATABLES_XLSX,
        UNITS_OUT,
    ))

    # ── Step 4: Weapon Data Tables ────────────────────────────────────────────
    # Reads the weapon file and merges weapon data into the JSON files
    # written by Step 3. Must run after convert_units.
    results.append(run_step(
        "Weapon Data Tables → src/data/units/ (weapons)",
        convert_weapons,
        WEAPON_DATATABLES_XLSX,
        WEAPONS_OUT,
    ))

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETE")
    print(f"{'='*60}")

    steps = ["Definitions", "Core Rules", "Inject RollTable", "Roll Tables", "Stratagems", "Objectives", "Inject ObjectiveGrid", "Inject Deployment Accordions", "Faction Index", "Unit Data Tables", "Weapon Data Tables"]
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
