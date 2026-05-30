"""
extract_stratagems.py
─────────────────────
Reads Stratagems from the Alt-Hammer Core Rules Word document and writes them
as a structured TypeScript file consumed by the StrategyGrid.astro component.

WHAT IT DOES
────────────
1. Parses the Core Rules .docx file
2. Finds the "Command Points & Stratagems" section
3. Extracts the Stratagems subsection data (currently in table format)
4. Converts to structured Stratagem objects with typed fields
5. Writes src/data/stratagems.ts

OUTPUT
──────
  src/data/stratagems.ts

File structure:
  export interface Stratagem {
    id: string;
    name: string;
    timing: string;
    description: string;
    cost: string;
    subRows?: Array<{ effect: string; cost: string }>;
  }

  export const STRATAGEMS: Stratagem[] = [ ... ];

HOW TO RUN
──────────
From the alt-hammer-site project folder:
  python scripts/extract_stratagems.py

Or use run_all.py to run it as part of the full pipeline.

CONFIGURATION
─────────────
Edit the paths below if your file locations change.
"""

import sys
import os
import re
from docx import Document
from docx.oxml.ns import qn

# ── Path configuration ────────────────────────────────────────────────────────

# Absolute path to your Core Rules Word document
CORE_RULES_DOCX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Core Rules.docx"

# Output path
OUTPUT_PATH = os.path.join("src", "data", "stratagems.ts")

# ─────────────────────────────────────────────────────────────────────────────

def sanitize_text(text: str) -> str:
    """Replace special Unicode characters with ASCII equivalents."""
    replacements = {
        '\u2013': '-',        # en dash
        '\u2014': '-',        # em dash
        '\u2018': "'",        # left single quote
        '\u2019': "'",        # right single quote
        '\u201c': '"',        # left double quote
        '\u201d': '"',        # right double quote
        '\u2026': '...',      # ellipsis
        '\u2022': '*',        # bullet
        '\u00b0': ' degrees', # degree symbol
        '\u2122': '(TM)',     # trademark
        '\u00ae': '(R)',      # registered
        '\u00a9': '(C)',      # copyright
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def slugify(text: str) -> str:
    """Convert text to kebab-case slug."""
    import re
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')


def extract_cell_text(cell) -> str:
    """Extract all text from a table cell."""
    text_parts = []
    for paragraph in cell.paragraphs:
        for run in paragraph.runs:
            text_parts.append(sanitize_text(run.text))
    return ''.join(text_parts).strip()


def paragraph_heading_level(para):
    """Return the numeric heading level for a paragraph, or None if it is not a heading."""
    if not para.style or not para.style.name:
        return None
    match = re.search(r'heading\s*(\d+)', para.style.name.lower())
    if match:
        return int(match.group(1))
    return None


def get_paragraph_index(doc, target_para):
    """Return the index of a paragraph in the document using the underlying XML element."""
    for index, para in enumerate(doc.paragraphs):
        if getattr(para, '_p', None) is getattr(target_para, '_p', None):
            return index
    return None


def log_section_headings(doc, parent_heading: str, limit: int = 20):
    """Print heading candidates under a parent section for debugging."""
    parent = find_section_by_heading(doc, parent_heading)
    if not parent:
        return

    parent_index = get_paragraph_index(doc, parent)
    if parent_index is None:
        return

    count = 0
    for i, para in enumerate(doc.paragraphs[parent_index + 1:], start=parent_index + 1):
        level = paragraph_heading_level(para)
        if level is not None:
            print(f"    [{i}] {para.style.name} | {para.text}")
            count += 1
            if count >= limit:
                break


def find_section_by_heading(doc, heading_text: str):
    """Find the first heading whose text matches heading_text."""
    for para in doc.paragraphs:
        level = paragraph_heading_level(para)
        if level is not None and heading_text.lower() in para.text.lower():
            return para
    return None


def find_subsection_by_heading(doc, parent_heading: str, subsection_text: str):
    """Find a subsection heading after a parent section heading."""
    parent = find_section_by_heading(doc, parent_heading)
    if not parent:
        return None

    parent_level = paragraph_heading_level(parent) or 0
    parent_index = get_paragraph_index(doc, parent)
    if parent_index is None:
        return None

    for para in doc.paragraphs[parent_index + 1:]:
        level = paragraph_heading_level(para)
        if level is not None and level <= parent_level:
            break

        if level is not None and subsection_text.lower() in para.text.lower():
            return para

    return None


def get_section_paragraphs(doc, parent_heading: str, subsection_text: str):
    """Return all paragraphs in a subsection until the next sibling heading."""
    subsection = find_subsection_by_heading(doc, parent_heading, subsection_text)
    if not subsection:
        return []

    subsection_level = paragraph_heading_level(subsection) or 0
    subsection_index = get_paragraph_index(doc, subsection)
    if subsection_index is None:
        return []

    paragraphs = []
    for para in doc.paragraphs[subsection_index + 1:]:
        level = paragraph_heading_level(para)
        if level is not None and level <= subsection_level:
            break

        paragraphs.append(para)

    return paragraphs


def find_table_after_heading(doc, heading_para):
    """Find the first table that appears after a given paragraph."""
    if not heading_para:
        return None
    
    heading_index = get_paragraph_index(doc, heading_para)
    if heading_index is None:
        return None

    found = False
    
    for i, element in enumerate(doc.element.body):
        if found and element.tag.endswith('tbl'):
            # Convert element to Table object
            from docx.table import Table
            return Table(element, doc)
        
        if element.tag.endswith('p'):
            para_index = sum(1 for e in doc.element.body[:i+1] if e.tag.endswith('p')) - 1
            if para_index == heading_index:
                found = True
    
    return None


def extract_stratagem_from_table_rows(table) -> list:
    """
    Parse stratagem table and extract stratagem objects.
    
    Table structure:
      Row 0: Header (Stratagem Name | When Stratagem can be Used | Stratagem Description | Command Point Cost)
      Rows 1+: Data rows
      Special: "Moment of Glory" spans multiple rows with sub-effects
    """
    stratagems = []
    current_stratagem = None
    skip_next = False
    
    for row_idx, row in enumerate(table.rows):
        if skip_next:
            skip_next = False
            continue
        
        # Skip header row
        if row_idx == 0:
            continue
        
        cells = [extract_cell_text(cell) for cell in row.cells]
        
        # Skip empty rows
        if not cells[0].strip():
            continue
        
        stratagem_name = cells[0].strip()
        
        # Check if this is a nested sub-row (sub-effects of Moment of Glory, etc.)
        # Sub-rows typically have empty first cell or are indented
        is_subrow = not cells[0].strip() or (cells[0].strip() and len(cells[0]) > 0 and 
                     any(c in cells[0][0] for c in '  \t'))
        
        if is_subrow and current_stratagem:
            # This is a sub-row for the current stratagem
            effect = cells[0].strip() if cells[0].strip() else cells[1].strip() if len(cells) > 1 else ""
            cost = cells[-1].strip()  # Last cell is always cost
            
            if effect or cost:
                if 'subRows' not in current_stratagem:
                    current_stratagem['subRows'] = []
                current_stratagem['subRows'].append({
                    'effect': effect,
                    'cost': cost,
                })
        else:
            # This is a main stratagem row
            when_used = cells[1].strip() if len(cells) > 1 else ""
            description = cells[2].strip() if len(cells) > 2 else ""
            cost = cells[3].strip() if len(cells) > 3 else cells[-1].strip()
            
            current_stratagem = {
                'id': slugify(stratagem_name),
                'name': stratagem_name,
                'timing': when_used,
                'description': description,
                'cost': cost,
            }
            stratagems.append(current_stratagem)
    
    return stratagems


def extract_stratagems_from_headings(paragraphs) -> list:
    """Parse stratagems from a heading-based subsection."""
    stratagems = []
    current_stratagem = None
    current_subheading = None

    for para in paragraphs:
        level = paragraph_heading_level(para)
        text = sanitize_text(para.text.strip())
        if not text:
            continue

        if level == 6:
            if current_stratagem:
                stratagems.append(current_stratagem)

            current_stratagem = {
                'id': slugify(text),
                'name': text,
                'maxUsesPerRound': '',
                'timing': '',
                'description': '',
                'cost': '',
            }
            current_subheading = None
            continue

        if level == 7 and current_stratagem:
            heading_label = text.lower()
            current_subheading = None
            if 'when used' in heading_label:
                current_subheading = 'timing'
            elif 'description' in heading_label:
                current_subheading = 'description'
            elif 'cost' in heading_label or 'command point' in heading_label:
                current_subheading = 'cost'
            elif 'max uses' in heading_label or 'max uses per battle round' in heading_label:
                current_subheading = 'maxUsesPerRound'
            else:
                current_subheading = None
            continue

        if current_stratagem and current_subheading:
            if current_stratagem[current_subheading]:
                current_stratagem[current_subheading] += '\n' + text
            else:
                current_stratagem[current_subheading] = text

    if current_stratagem:
        stratagems.append(current_stratagem)

    return stratagems


def extract_stratagems(docx_path: str = CORE_RULES_DOCX, output_path: str = OUTPUT_PATH) -> None:
    """
    Main extraction function.
    """
    print(f"\n{'='*60}")
    print(f"  Extracting Stratagems from Core Rules")
    print(f"{'='*60}")
    print(f"  Source:  {docx_path}")
    print(f"  Output:  {output_path}")
    print(f"{'='*60}\n")
    
    # Check source file exists
    if not os.path.exists(docx_path):
        print(f"  ✗  ERROR: Source file not found: {docx_path}")
        return False
    
    try:
        doc = Document(docx_path)
        
        # Find the Stratagems subsection
        stratagem_paragraphs = get_section_paragraphs(
            doc,
            "Command Points & Stratagems",
            "Stratagems"
        )
        
        if not stratagem_paragraphs:
            print("  ✗  ERROR: Could not find 'Stratagems' subsection")
            print("  DEBUG: Available headings under 'Command Points & Stratagems':")
            log_section_headings(doc, "Command Points & Stratagems")
            return False
        
        # Extract stratagem data from heading structure first
        stratagems = extract_stratagems_from_headings(stratagem_paragraphs)
        
        if not stratagems:
            # Fallback to table extraction if headings are not present
            stratagems_heading = find_subsection_by_heading(
                doc,
                "Command Points & Stratagems",
                "Stratagems"
            )
            table = find_table_after_heading(doc, stratagems_heading)
            
            if not table:
                print("  ✗  ERROR: Could not find Stratagems table")
                return False
            
            stratagems = extract_stratagem_from_table_rows(table)
            
            if not stratagems:
                print("  ✗  ERROR: No stratagems found in table")
                return False
        
        print(f"  Found {len(stratagems)} stratagems\n")
        
        # Generate TypeScript file
        ts_content = generate_typescript_file(stratagems)
        
        # Write output
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(ts_content)
        
        print(f"  ✓  Wrote {len(stratagems)} stratagems to {output_path}")
        print(f"{'='*60}\n")
        return True
    
    except Exception as e:
        print(f"  ✗  ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def generate_typescript_file(stratagems: list) -> str:
    """Generate the TypeScript source code for stratagems."""
    
    # Build the interface definition
    interface = """export interface Stratagem {
  id: string;
  name: string;
  timing: string;
  description: string;
  cost: string;
  subRows?: Array<{
    effect: string;
    cost: string;
  }>;
}
"""
    
    # Build the data array
    data_lines = ["export const STRATAGEMS: Stratagem[] = ["]
    
    for strat in stratagems:
        data_lines.append("  {")
        data_lines.append(f'    id: "{strat["id"]!s}",')
        data_lines.append(f'    name: "{escape_string(strat["name"])}",')
        data_lines.append(f'    maxUsesPerRound: "{escape_string(strat.get("maxUsesPerRound", ""))}",')
        data_lines.append(f'    timing: "{escape_string(strat["timing"])}",')
        data_lines.append(f'    description: "{escape_string(strat["description"])}",')
        data_lines.append(f'    cost: "{escape_string(strat["cost"])}",')
        
        if strat.get('subRows'):
            data_lines.append("    subRows: [")
            for subrow in strat['subRows']:
                data_lines.append("      {")
                data_lines.append(f'        effect: "{escape_string(subrow["effect"])}",')
                data_lines.append(f'        cost: "{escape_string(subrow["cost"])}",')
                data_lines.append("      },")
            data_lines.append("    ],")
        
        data_lines.append("  },")
    
    data_lines.append("];")
    
    header = f"""// Auto-generated by extract_stratagems.py
// DO NOT EDIT MANUALLY — regenerate from Word document

"""
    
    return header + interface + "\n" + "\n".join(data_lines)


def escape_string(s: str) -> str:
    """Escape a string for TypeScript string literal."""
    s = str(s)
    s = s.replace('\\', '\\\\')
    s = s.replace('"', '\\"')
    s = s.replace('\n', '\\n')
    s = s.replace('\r', '\\r')
    s = s.replace('\t', '\\t')
    return s


if __name__ == '__main__':
    docx_path = sys.argv[1] if len(sys.argv) > 1 else CORE_RULES_DOCX
    out_path = sys.argv[2] if len(sys.argv) > 2 else OUTPUT_PATH
    success = extract_stratagems(docx_path, out_path)
    sys.exit(0 if success else 1)
