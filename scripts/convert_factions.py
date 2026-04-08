"""
convert_factions.py
───────────────────
Converts the Alt-Hammer Faction Rules Index Word document (.docx)
into one Markdown (.mdx) file per faction for the website.

WHAT IT DOES
────────────
1. Reads the Faction Rules Index .docx file
2. Splits the document by faction (detected by alliance group headings
   and faction-level Heading 2 entries)
3. Within each faction, splits content into:
     - Army Rules
     - Detachment Traits
     - Wargear Upgrades
     - Unit Profiles (one sub-section per unit)
4. Detects 'Keyword' and 'Action' character styles throughout
5. Writes one .mdx file per faction into src/content/factions/

OUTPUT FILES
────────────
  src/content/factions/adeptus-astartes.mdx
  src/content/factions/astra-militarum.mdx
  src/content/factions/adeptus-ministorum.mdx
  ... etc.

HOW TO RUN
──────────
  python scripts/convert_factions.py

Or double-click run_all.py to convert everything at once.
"""

import sys
import os
import re

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from docx import Document
from ah_converter_utils import (
    get_heading_level,
    paragraph_to_markdown,
    runs_to_markdown,
    write_mdx_file,
    slugify,
    ensure_dir,
)

# ── Path configuration ────────────────────────────────────────────────────────

FACTION_INDEX_DOCX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Faction Rules Index.docx"

OUTPUT_DIR = "src/content/factions"

# ── Alliance detection ────────────────────────────────────────────────────────

# Heading 1 text patterns that identify alliance group headers (not factions)
ALLIANCE_HEADERS = [
    'the imperium',
    'forces of chaos',
    'the aeldari',
    'aeldari',
    'the great devourer',
    'xenos',
    'broader xenos',
    'introduction',
    'table of contents',
]

# Maps faction name slugs to their alliance
FACTION_ALLIANCE_MAP = {
    'adeptus-astartes':    'imperium',
    'astra-militarum':     'imperium',
    'adeptus-ministorum':  'imperium',
    'adeptus-mechanicus':  'imperium',
    'adeptus-custodes':    'imperium',
    'agents-of-the-imperium': 'imperium',
    'chaos-undivided':     'chaos',
    'chaos-daemons':       'chaos',
    'the-bloodbound-of-khorne': 'chaos',
    'the-plaguebound-of-nurgle': 'chaos',
    'the-velvet-choirs-of-slaanesh': 'chaos',
    'the-thousand-eyes-of-tzeentch': 'chaos',
    'tyranids':            'devourer',
    'genestealer-cults':   'devourer',
    'asuryani':            'aeldari',
    'drukhari':            'aeldari',
    'orks':                'xenos',
    'tau-empire':          'xenos',
    'the-necrontyr':       'xenos',
    'necrontyr':           'xenos',
    'leagues-of-votann':   'xenos',
}

# Known section heading names within a faction
ARMY_RULES_HEADINGS    = ['army rules', 'army rule']
DETACHMENT_HEADINGS    = ['detachment traits', 'detachment abilities', 'detachment rules']
WARGEAR_HEADINGS       = ['wargear upgrades', 'wargear options', 'wargear']
UNIT_SECTION_HEADINGS  = ['units', 'unit profiles', 'unit rules']


def heading_matches(text: str, patterns: list[str]) -> bool:
    """Check if a heading text matches any pattern (case-insensitive)."""
    t = text.lower().strip()
    return any(t == p or t.startswith(p) for p in patterns)


def is_alliance_header(text: str) -> bool:
    """Return True if this heading is an alliance group header, not a faction."""
    return text.lower().strip() in ALLIANCE_HEADERS


def convert_factions(docx_path: str, output_dir: str):
    print(f"\n{'='*60}")
    print(f"  Alt-Hammer — Converting Faction Rules Index")
    print(f"{'='*60}")
    print(f"  Source:  {docx_path}")
    print(f"  Output:  {output_dir}")
    print(f"{'='*60}\n")

    if not os.path.exists(docx_path):
        print(f"  ✗  ERROR: Source file not found:")
        print(f"     {docx_path}")
        print(f"\n  Please check the FACTION_INDEX_DOCX path at the top of this script.")
        sys.exit(1)

    doc = Document(docx_path)
    paragraphs = doc.paragraphs

    # ── Pass 1: identify faction boundaries ──────────────────────────────────
    # A faction starts at any Heading 2 that is NOT an alliance header
    # and NOT a known section heading name.
    
    faction_starts = []  # list of (paragraph_index, faction_name)

    for i, para in enumerate(paragraphs):
        level = get_heading_level(para)
        text = para.text.strip()

        if not text:
            continue

        if level == 2 and not is_alliance_header(text):
            # Check it's not a section heading within a faction
            if not heading_matches(text, ARMY_RULES_HEADINGS + DETACHMENT_HEADINGS +
                                         WARGEAR_HEADINGS + UNIT_SECTION_HEADINGS):
                faction_starts.append((i, text))

    print(f"  Found {len(faction_starts)} factions\n")

    # ── Pass 2: extract content for each faction ──────────────────────────────

    written = 0

    for idx, (start_idx, faction_name) in enumerate(faction_starts):
        # Determine end of this faction's paragraphs
        end_idx = faction_starts[idx + 1][0] if idx + 1 < len(faction_starts) else len(paragraphs)

        faction_slug = slugify(faction_name)
        alliance = FACTION_ALLIANCE_MAP.get(faction_slug, 'unknown')

        print(f"  Processing: {faction_name}")

        # Collect paragraphs for this faction
        faction_paras = paragraphs[start_idx + 1 : end_idx]

        # ── Segment into the four main sections ──────────────────────────────
        sections = {
            'army_rules':        [],
            'detachment_traits': [],
            'wargear':           [],
            'units':             [],
        }

        current_section = 'army_rules'  # default until we find a heading
        list_counter = {}

        for para in faction_paras:
            text = para.text.strip()
            level = get_heading_level(para)

            if not text:
                # Preserve blank lines within sections
                if sections[current_section]:
                    sections[current_section].append('')
                continue

            # Detect section switches by heading text
            if level is not None:
                if heading_matches(text, ARMY_RULES_HEADINGS):
                    current_section = 'army_rules'
                    list_counter = {}
                    continue  # don't include the section heading itself
                elif heading_matches(text, DETACHMENT_HEADINGS):
                    current_section = 'detachment_traits'
                    list_counter = {}
                    continue
                elif heading_matches(text, WARGEAR_HEADINGS):
                    current_section = 'wargear'
                    list_counter = {}
                    continue
                elif heading_matches(text, UNIT_SECTION_HEADINGS):
                    current_section = 'units'
                    list_counter = {}
                    continue

            md_line = paragraph_to_markdown(para, list_counter)
            if md_line:
                sections[current_section].append(md_line)

        # ── Build the .mdx file content ───────────────────────────────────────

        def section_to_md(lines: list[str], heading: str, level: int = 2) -> str:
            """Wrap section lines with a heading if there's content."""
            content = '\n'.join(lines).strip()
            if not content:
                return ''
            prefix = '#' * level
            return f"{prefix} {heading}\n\n{content}\n"

        body_parts = []

        army_rules_md = section_to_md(sections['army_rules'], 'Army Rules')
        if army_rules_md:
            body_parts.append(army_rules_md)

        detachment_md = section_to_md(sections['detachment_traits'], 'Detachment Traits')
        if detachment_md:
            body_parts.append(detachment_md)

        wargear_md = section_to_md(sections['wargear'], 'Wargear Upgrades')
        if wargear_md:
            body_parts.append(wargear_md)

        units_md = section_to_md(sections['units'], 'Units')
        if units_md:
            body_parts.append(units_md)

        body = '\n\n'.join(body_parts)

        # Skip if no meaningful content was found
        if not body.strip():
            print(f"    —  Skipping {faction_name}: no content detected")
            continue

        # ── Write the file ────────────────────────────────────────────────────

        frontmatter = {
            'title': faction_name,
            'slug': faction_slug,
            'alliance': alliance,
            'status': 'active',
            'description': '',
        }

        output_path = os.path.join(output_dir, f"{faction_slug}.mdx")
        write_mdx_file(output_path, frontmatter, body)
        written += 1

    print(f"\n{'='*60}")
    print(f"  Complete: {written} faction files written")
    print(f"  Output directory: {output_dir}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    docx_path = sys.argv[1] if len(sys.argv) > 1 else FACTION_INDEX_DOCX
    out_dir   = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_DIR

    convert_factions(docx_path, out_dir)
