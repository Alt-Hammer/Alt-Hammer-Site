"""
extract_definitions.py
──────────────────────
Extracts all Keyword and Action definitions from the Core Rules Word document
and writes them to src/data/definitions.json.

This JSON file is embedded into every page by BaseLayout.astro as
window.AH_DEFINITIONS, and read by the tooltip JavaScript to populate
hover tooltips wherever keyword/action spans appear in content.

WHAT IT EXTRACTS
────────────────
From the "Keywords & Abilities" Heading 1 section:
  Every Heading 6 entry and its body text → stored as type "keyword"

From the "Actions & Activation Points" Heading 1 section:
  Every Heading 6 entry and its body text → stored as type "action"
  (Skips "Example Scenario" and "Design Note" sub-headings)

SLUG STRATEGY
─────────────
Parameterized keywords like "Feel No Pain [X]+" are stored under their
base slug "feel-no-pain" (stripping [X], +, ", and digit suffixes).

The tooltip JavaScript does an exact slug lookup first, then falls back
to progressively stripping the last hyphen-segment until it finds a
match. This means "feel-no-pain-5" (from in-text "Feel No Pain 5+")
automatically resolves to the "feel-no-pain" definition.

HOW TO RUN
──────────
From inside the alt-hammer-site folder:
  python scripts/extract_definitions.py

Or it is called automatically by run_all.py.

CONFIGURATION
─────────────
Edit CORE_RULES_DOCX below if your file path changes.
"""

import sys
import os
import re
import json

# ── Path configuration ────────────────────────────────────────────────────────


CORE_RULES_DOCX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Core Rules.docx"
OUTPUT_PATH = "src/data/definitions.json"

# ─────────────────────────────────────────────────────────────────────────────

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from docx import Document
from docx.oxml.ns import qn


# Heading 1 section names that contain definitions to extract
TARGET_SECTIONS = {
    'Keywords & Abilities': 'keyword',
    'Actions & Activation Points': 'action',
}

# Heading 4 titles to skip (not actual definitions)
SKIP_HEADINGS = {'example scenario', 'design note'}


def get_xml_style(run):
    """Return the rStyle value from XML, or None."""
    rpr = run._r.find(qn('w:rPr'))
    if rpr is not None:
        rstyle = rpr.find(qn('w:rStyle'))
        if rstyle is not None:
            return rstyle.get(qn('w:val'))
    return None


def sanitize(text: str) -> str:
    """Replace smart quotes and other Unicode characters with ASCII equivalents."""
    replacements = {
        '\u2018': "'", '\u2019': "'",
        '\u201c': '"', '\u201d': '"',
        '\u2013': '-', '\u2014': '-',
        '\u2026': '...',
        '\u00a0': ' ',   # non-breaking space
        '\u202f': ' ',   # narrow no-break space
        '\u200b': '',    # zero-width space
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def para_to_plain_text(para) -> str:
    """Convert a paragraph's runs to plain text with no markup."""
    parts = []
    for run in para.runs:
        text = run.text
        if text:
            parts.append(sanitize(text))
    return ''.join(parts).strip()


def slugify_definition_heading(text: str) -> str:
    """
    Convert a definition heading to its base slug.

    Strips:
      - Tab-separated AP cost suffix  ("Move\\t1 Activation Point" → "Move")
      - [X] and [KEYWORD] placeholders
      - Trailing + characters
      - Trailing inch-mark characters
      - Numeric/letter suffixes after stripping

    Then applies standard slug rules (lowercase, spaces→hyphens).

    Examples:
      "Feel No Pain [X]+"          → "feel-no-pain"
      "Rapid Fire [X]"             → "rapid-fire"
      "Scout [X]\\""               → "scout"
      "Anti-[KEYWORD] [X]+"        → "anti"
      "Heavy"                      → "heavy"
      "Charge and Fight"           → "charge-and-fight"
      "Move\\t1 Activation Point"  → "move"
    """
    # Strip tab-separated cost suffix
    text = text.split('\t')[0].strip()
    # Remove placeholder tokens like [X], [KEYWORD], etc.
    text = re.sub(r'\[.*?\]', '', text)
    # Remove + and " characters
    text = text.replace('+', '').replace('"', '')
    # Standard slugify
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')


def extract_definitions(docx_path: str) -> list[dict]:
    """
    Parse the Core Rules document and extract all keyword/action definitions.

    Returns a list of dicts:
      {
        'slug': str,    # base slug used as the lookup key
        'name': str,    # display name (heading text, tab-part stripped)
        'type': str,    # 'keyword' or 'action'
        'body': str,    # full rule text, paragraphs joined with newlines
                        # list items prefixed with '• '
      }
    """
    doc = Document(docx_path)
    paragraphs = list(doc.paragraphs)
    n = len(paragraphs)

    current_h1 = None
    current_type = None
    in_target = False
    entries = []
    i = 0

    while i < n:
        para = paragraphs[i]
        text = para.text.strip()
        style = para.style.name if para.style else ''

        # Track which H1 section we're in
        if 'Heading 1' in style:
            current_h1 = text
            current_type = TARGET_SECTIONS.get(text)
            in_target = current_type is not None
            i += 1
            continue

        # Within a target section, each H6 starts a definition
        if in_target and 'Heading 6' in style and text:
            # The heading text may include a tab + AP cost: strip it for display
            heading_display = text.split('\t')[0].strip()
            slug = slugify_definition_heading(text)

            # Skip non-definition sub-headings
            if heading_display.lower() in SKIP_HEADINGS:
                i += 1
                continue

            # Collect body paragraphs until the next heading of any level
            body_lines = []
            i += 1
            while i < n:
                next_para = paragraphs[i]
                next_style = next_para.style.name if next_para.style else ''

                if any(f'Heading {x}' in next_style for x in range(1, 8)):
                    break

                line = para_to_plain_text(next_para)
                if line:
                    if 'List' in next_style:
                        body_lines.append(f'• {line}')
                    else:
                        body_lines.append(line)
                i += 1

            body = '\n'.join(body_lines).strip()

            entries.append({
                'slug': slug,
                'name': heading_display,
                'type': current_type,
                'body': body,
            })
            continue

        i += 1

    return entries


def main():
    docx_path = sys.argv[1] if len(sys.argv) > 1 else CORE_RULES_DOCX
    out_path  = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_PATH

    print(f"\n{'='*60}")
    print(f"  Alt-Hammer — Extracting Keyword & Action Definitions")
    print(f"{'='*60}")
    print(f"  Source:  {docx_path}")
    print(f"  Output:  {out_path}")
    print(f"{'='*60}\n")

    if not os.path.exists(docx_path):
        print(f"  ✗  ERROR: Source file not found:\n     {docx_path}")
        sys.exit(1)

    print("  Parsing document...")
    entries = extract_definitions(docx_path)
    print(f"  Found {len(entries)} definitions ({sum(1 for e in entries if e['type']=='keyword')} keywords, "
          f"{sum(1 for e in entries if e['type']=='action')} actions)\n")

    # Build the output dict: slug → definition
    definitions = {}
    for entry in entries:
        if entry['slug'] in definitions:
            print(f"  ⚠  Duplicate slug '{entry['slug']}' — keeping first entry")
            continue
        definitions[entry['slug']] = {
            'name': entry['name'],
            'type': entry['type'],
            'body': entry['body'],
        }
        print(f"  ✓  {entry['type']:8s} | {entry['slug']:40s} | {entry['name']}")

    # Write output
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(definitions, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"  Complete: {len(definitions)} definitions written to {out_path}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
