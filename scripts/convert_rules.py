"""
convert_rules.py
────────────────
Converts the Alt-Hammer Core Rules Word document (.docx) into
Markdown (.mdx) files for the website.

WHAT IT DOES
────────────
1. Reads the Core Rules .docx file
2. Splits the document by Heading 1 into separate sections
3. Detects 'Keyword' and 'Action' character styles and wraps them
   in the correct HTML span tags for tooltip functionality
4. Writes one .mdx file per section into src/content/rules/

OUTPUT FILES
────────────
Each Heading 1 section becomes its own file:
  src/content/rules/introduction.mdx
  src/content/rules/preparing-your-game.mdx
  src/content/rules/the-battle-round.mdx
  src/content/rules/actions-and-activation-points.mdx
  ... etc.

HOW TO RUN
──────────
From the alt-hammer-site project folder, in your terminal:
  python scripts/convert_rules.py

Or double-click run_all.py to convert everything at once.

CONFIGURATION
─────────────
Edit the paths below if your file locations change.
"""

import sys
import os

# ── Path configuration ────────────────────────────────────────────────────────

# Absolute path to your Core Rules Word document
CORE_RULES_DOCX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Core Rules.docx"

# Output directory — relative to where you run the script from
# Run this script from inside the alt-hammer-site folder
OUTPUT_DIR = "src/content/rules"

# ─────────────────────────────────────────────────────────────────────────────

# Add the scripts folder to path so we can import utilities
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from ah_converter_utils import (
    doc_to_markdown_sections,
    write_mdx_file,
    slugify,
)


def convert_rules(docx_path: str, output_dir: str):
    """
    Main conversion function.
    Reads the Core Rules docx and writes one .mdx file per Heading 1 section.
    """
    print(f"\n{'='*60}")
    print(f"  Alt-Hammer — Converting Core Rules")
    print(f"{'='*60}")
    print(f"  Source:  {docx_path}")
    print(f"  Output:  {output_dir}")
    print(f"{'='*60}\n")

    # Check source file exists
    if not os.path.exists(docx_path):
        print(f"  ✗  ERROR: Source file not found:")
        print(f"     {docx_path}")
        print(f"\n  Please check the CORE_RULES_DOCX path at the top of this script.")
        sys.exit(1)

    # Parse the document
    print("  Parsing document...")
    sections = doc_to_markdown_sections(docx_path)
    print(f"  Found {len(sections)} top-level sections\n")

    if not sections:
        print("  ✗  No sections found. Check that your document uses Heading 1 styles.")
        sys.exit(1)

    # Write one file per section
    written = 0
    skipped = 0

    for section in sections:
        title = section['title']
        slug = section['slug']
        content = section['content']

        # Skip the Table of Contents if present
        if slug in ('table-of-contents', 'contents', 'toc'):
            print(f"  —  Skipping: {title} (table of contents)")
            skipped += 1
            continue

        if not content.strip():
            print(f"  —  Skipping: {title} (empty section)")
            skipped += 1
            continue

        # Build frontmatter
        frontmatter = {
            'title': title,
            'slug': slug,
            'description': f"Alt-Hammer 40,000 Core Rules — {title}",
            'section': 'core-rules',
            'subsections': section['subsections'],
        }

        output_path = os.path.join(output_dir, f"{slug}.mdx")
        write_mdx_file(output_path, frontmatter, content)
        written += 1

    print(f"\n{'='*60}")
    print(f"  Complete: {written} files written, {skipped} skipped")
    print(f"  Output directory: {output_dir}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    # Allow overriding paths via command line arguments
    docx_path = sys.argv[1] if len(sys.argv) > 1 else CORE_RULES_DOCX
    out_dir   = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_DIR

    convert_rules(docx_path, out_dir)
