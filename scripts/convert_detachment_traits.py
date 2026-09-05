"""
convert_detachment_traits.py
-----------------------------
Parses faction Detachment Traits from the Faction Rules Index .docx and writes
structured JSON for every faction.

Detachment Traits live under each faction's H3: Detachment Traits section.
Each trait is an H6 heading (tab-separated "Name\tX Detachment Points") with
body-paragraph effect descriptions that follow it. Some factions also use H4
headings to group traits into named categories.

OUTPUT
------
  src/data/detachment-traits/astra-militarum.json
  src/data/detachment-traits/adeptus-astartes.json
  ... (one file per faction)

USAGE
-----
  python scripts/convert_detachment_traits.py
  python scripts/convert_detachment_traits.py --faction astra-militarum
"""

import sys
import os
import re
import json
import argparse

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from docx import Document
from ah_converter_utils import get_heading_level, slugify, ensure_dir, render_prose_html

# ── Path configuration ────────────────────────────────────────────────────────

# Source document paths are centralised in source_paths.py — see that file
# to change where the documents live or what they are called.
from source_paths import FACTION_INDEX_DOCX
OUTPUT_DIR = "src/data/detachment-traits"

# ── Heading classification sets ───────────────────────────────────────────────

ALLIANCE_HEADERS = {
    'the imperium', 'forces of chaos', 'the aeldari', 'aeldari',
    'the great devourer', 'xenos', 'broader xenos',
    'introduction', 'table of contents',
}
H3_DETACHMENT = {'detachment traits', 'detachment abilities', 'detachment rules'}


# ── Text helpers ──────────────────────────────────────────────────────────────

def clean(text) -> str:
    return (
        str(text or '').strip()
        .replace(''', "'").replace(''', "'")
        .replace('"', '"').replace('"', '"')
        .replace('–', '-').replace('—', '-')
        .replace(' ', ' ')
    )


def parse_dp_cost(raw: str):
    """
    Extract Detachment Points cost from a cost string like '2 Detachment Points'.
    Returns int or None.
    """
    m = re.search(r'(\d+)\s+detachment\s+point', raw, re.I)
    return int(m.group(1)) if m else None


def extract_pool_size(intro_text: str):
    """
    Try to extract the total detachment points pool from the faction intro.
    e.g. "Your army possesses 2 Detachment Points..." -> 2
    """
    m = re.search(r'possesses\s+(\d+)\s+detachment\s+point', intro_text, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r'(\d+)\s+detachment\s+point', intro_text, re.I)
    return int(m.group(1)) if m else None


# ── Main conversion ───────────────────────────────────────────────────────────

def convert_detachment_traits(
    docx_path: str,
    output_dir: str,
    faction_filter=None,
):
    print("")
    print("=" * 60)
    print("  Countermarch -- Converting Detachment Traits")
    print("=" * 60)
    print(f"  Source:  {docx_path}")
    print(f"  Output:  {output_dir}")
    if faction_filter:
        print(f"  Filter:  {faction_filter}")
    print("=" * 60)
    print("")

    if not os.path.exists(docx_path):
        print(f"  ERROR: Source file not found:\n     {docx_path}")
        sys.exit(1)

    doc        = Document(docx_path)
    paragraphs = doc.paragraphs

    # -- Locate faction boundaries -------------------------------------------
    faction_spans = []
    for i, para in enumerate(paragraphs):
        text  = clean(para.text)
        level = get_heading_level(para)
        if level == 2 and text.lower() not in ALLIANCE_HEADERS:
            faction_spans.append((text, i))

    faction_ranges = []
    for idx, (name, start) in enumerate(faction_spans):
        end = faction_spans[idx + 1][1] if idx + 1 < len(faction_spans) else len(paragraphs)
        faction_ranges.append((name, start, end))

    print(f"  Found {len(faction_ranges)} factions")
    print("")

    written = 0

    for faction_name, fstart, fend in faction_ranges:
        faction_slug = slugify(faction_name)

        if faction_filter and faction_slug != faction_filter:
            continue

        print(f"  Processing: {faction_name}  ({faction_slug})")

        faction_paras = paragraphs[fstart + 1 : fend]

        # -- Locate the Detachment Traits H3 section -------------------------
        detach_paras = []
        in_detach    = False

        for para in faction_paras:
            text  = clean(para.text)
            level = get_heading_level(para)

            if level in (1, 2):
                in_detach = False
                continue
            if level == 3:
                in_detach = text.lower() in H3_DETACHMENT
                continue
            if in_detach:
                detach_paras.append(para)

        if not detach_paras:
            print(f"    No detachment traits section found")
            # Still write an empty file so the pipeline is consistent
            output = {
                'faction':           faction_name,
                'slug':              faction_slug,
                'detachmentPoints':  None,
                'introText':         None,
                'detachmentTraits':  [],
            }
            output_path = os.path.join(output_dir, f"{faction_slug}.json")
            ensure_dir(output_dir)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(output, f, indent=2, ensure_ascii=False)
            print(f"    Written: {output_path}")
            print("")
            written += 1
            continue

        # -- Parse traits ----------------------------------------------------
        traits         = []
        intro_text     = None   # opening body text before any H6
        pool_size      = None   # detachment points available to the faction
        current_cat    = None   # H4 category (e.g. "Chapter Identity Detachment Traits")
        current_trait  = None
        current_effects= []
        current_paras  = []     # the same body paragraphs, for the rich render
        seen_first_h6  = False

        def flush_trait():
            nonlocal current_trait, current_effects, current_paras
            if current_trait is None:
                return
            trait = {**current_trait, 'effects': current_effects}
            # Reader-facing prose: same paragraphs, but keeping the bullet/paragraph
            # structure and the keyword/weapon/wargear spans that `effects` drops.
            html = render_prose_html(current_paras)
            if html:
                trait['effectsHtml'] = html
            traits.append(trait)
            current_trait  = None
            current_effects= []
            current_paras  = []

        for para in detach_paras:
            text  = clean(para.text)
            level = get_heading_level(para)

            if not text:
                continue

            if level in (1, 2, 3):
                flush_trait()
                break

            if level == 4:
                flush_trait()
                current_cat = text
                continue

            if level == 5:
                # H5 used occasionally for sub-groupings
                flush_trait()
                current_cat = text
                continue

            if level == 6:
                flush_trait()
                seen_first_h6 = True
                if '\t' in text:
                    name_part, cost_part = text.split('\t', 1)
                else:
                    name_part, cost_part = text, ''
                name_part = name_part.strip()
                dp_cost   = parse_dp_cost(cost_part) if cost_part else None
                current_trait = {
                    'traitId':              slugify(name_part),
                    'name':                 name_part,
                    'detachmentPointsCost': dp_cost,
                    'category':             current_cat,
                }
                current_effects = []
                current_paras   = []
                continue

            if level in (7, 8):
                if current_trait is not None:
                    current_effects.append(text)
                    current_paras.append(para)
                continue

            # Body paragraph
            if current_trait is not None:
                current_effects.append(text)
                current_paras.append(para)
            elif not seen_first_h6:
                # Introductory paragraph before any trait
                if intro_text is None:
                    intro_text = text
                    pool_size  = extract_pool_size(text)
                else:
                    intro_text += ' ' + text

        flush_trait()

        # -- Report ----------------------------------------------------------
        cats = {t['category'] for t in traits if t['category']}
        print(f"    Detachment Points pool : {pool_size}")
        print(f"    Traits parsed          : {len(traits)}")
        if cats:
            print(f"    Categories             : {', '.join(sorted(cats))}")

        # -- Write JSON ------------------------------------------------------
        output = {
            'faction':          faction_name,
            'slug':             faction_slug,
            'detachmentPoints': pool_size,
            'introText':        intro_text,
            'detachmentTraits': traits,
        }
        output_path = os.path.join(output_dir, f"{faction_slug}.json")
        ensure_dir(output_dir)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"    Written: {output_path}")
        print("")
        written += 1

    print("=" * 60)
    print(f"  Complete: {written} detachment-traits JSON file(s) written")
    print("=" * 60)
    print("")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Convert faction detachment traits to JSON'
    )
    parser.add_argument(
        '--faction', '-f',
        help='Slug of a single faction to process',
        default=None,
    )
    parser.add_argument('--docx',   default=FACTION_INDEX_DOCX)
    parser.add_argument('--output', default=OUTPUT_DIR)
    args = parser.parse_args()

    convert_detachment_traits(args.docx, args.output, args.faction)
