"""
extract_objectives.py
─────────────────────
Reads Secondary Mission Objectives from the Alt-Hammer Core Rules Word document
and writes them as a structured TypeScript file consumed by ObjectiveGrid.astro.

WHAT IT DOES
────────────
1. Parses the Core Rules .docx file
2. Finds the "Generating a Battle" section
3. Extracts the "Optional Game Feature: Secondary Mission Objectives" subsection
4. Uses heading-driven extraction for themes, objectives, and subsections
5. Writes src/data/objectives.ts

OUTPUT
──────
  src/data/objectives.ts

File structure:
  export interface ObjectivePoints {
    condition: string;
    points: number;
  }

  export interface SecondaryObjective {
    id: string;
    number: number;
    name: string;
    timing: string;
    description: string;
    pointsAwarded: ObjectivePoints[];
    theme?: string;
    diceRange?: string;
    gameEffects?: string;
  }

  export const SECONDARY_OBJECTIVES: SecondaryObjective[] = [ ... ];

HOW TO RUN
──────────
From the alt-hammer-site project folder:
  python scripts/extract_objectives.py

Or use run_all.py to run it as part of the full pipeline.

CONFIGURATION
─────────────
Edit the paths below if your file locations change.
"""
import sys
import os
import re
from docx import Document
import html

# ── Path configuration ────────────────────────────────────────────────────────

# Absolute path to your Core Rules Word document
CORE_RULES_DOCX = r"C:\Users\alexc\OneDrive\04 Documents\Warhammer 40k\Alt-Hammer Standalone\Alt-Hammer 40,000 1st Edition - Core Rules.docx"

# Output path
OUTPUT_PATH = os.path.join("src", "data", "objectives.ts")

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
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')


def extract_cell_text(cell) -> str:
    """Extract all text from a table cell."""
    # python-docx cell.text preserves paragraph breaks using newlines.
    text = cell.text or ""
    return sanitize_text(text).strip()


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




def parse_points_cell(points_text: str) -> list:
    """
    Parse a points awarded cell with minimal structure.
    Preserves raw line text rather than over-parsing it.
    """
    points = []
    points_text = points_text.strip()
    if not points_text:
        return points

    lines = [line.strip() for line in re.split(r'[\r\n]+', points_text) if line.strip()]
    for line in lines:
        if line.isdigit():
            points.append({
                'condition': 'Points',
                'points': int(line),
            })
        else:
            points.append({
                'condition': line,
                'points': 0,
            })

    return points


def extract_objectives_from_headings(paragraphs) -> list:
    """Parse objectives from a heading-based subsection."""
    objectives = []
    current_objective = None
    current_theme = None
    current_subheading = None
    objective_counter = 0

    def para_to_html(para):
        """Render a paragraph's runs to minimal HTML, preserving bold/italic and 'keyword' character style."""
        parts = []
        for run in para.runs:
            text = sanitize_text(run.text or '')
            if not text:
                continue
            text = html.escape(text)
            content = text
            try:
                style_name = (run.style.name or '').lower() if run.style else ''
            except Exception:
                style_name = ''
            if getattr(run, 'bold', False):
                content = f"<strong>{content}</strong>"
            if getattr(run, 'italic', False):
                content = f"<em>{content}</em>"
            if style_name and 'keyword' in style_name:
                content = f"<span class=\"keyword\">{content}</span>"
            parts.append(content)
        return ''.join(parts)

    for para in paragraphs:
        level = paragraph_heading_level(para)
        text = sanitize_text(para.text.strip())
        if not text:
            continue

        if level == 5:
            current_theme = text
            continue

        if level == 6:
            if current_objective:
                objectives.append(current_objective)

            objective_counter += 1
            parts = re.split(r'[\t\n]+', text, maxsplit=1)
            objective_name = parts[0].strip()
            dice_range = ''
            if len(parts) > 1:
                dice_range = parts[1].strip()

            current_objective = {
                'id': slugify(objective_name),
                'number': objective_counter,
                'name': objective_name,
                'timing': '',
                'description': '',
                'pointsAwarded': [],
                'diceRange': '',
            }
            if current_theme:
                current_objective['theme'] = current_theme
            if dice_range:
                current_objective['diceRange'] = dice_range
            current_subheading = None
            continue

        if level == 7 and current_objective:
            heading_label = text.lower()
            current_subheading = None

            if 'description' in heading_label:
                current_subheading = 'description'
            elif 'points awarded' in heading_label or 'points' in heading_label:
                current_subheading = 'pointsAwarded'
            elif 'game effects' in heading_label or 'game effect' in heading_label:
                current_subheading = 'gameEffects'
            elif re.search(r'\bd6\b.*\broll\b', heading_label):
                current_subheading = 'diceRange'
                range_match = re.search(r'(\d+\s*-\s*\d+)', heading_label)
                if range_match:
                    current_objective['diceRange'] = range_match.group(1).strip()
            elif re.search(r'\d+\s*-\s*\d+', heading_label):
                current_subheading = 'diceRange'
                current_objective['diceRange'] = re.search(r'(\d+\s*-\s*\d+)', heading_label).group(1).strip()
            elif 'completion' in heading_label and 'tim' in heading_label:
                current_subheading = 'timing'
            elif 'when' in heading_label and 'tim' in heading_label:
                current_subheading = 'timing'
            elif 'when used' in heading_label:
                current_subheading = 'timing'
            elif 'when' in heading_label and 'use' in heading_label:
                current_subheading = 'timing'

            continue

        if current_objective and current_subheading:
            if current_subheading == 'pointsAwarded':
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                for line in lines:
                    points = parse_points_cell(line)
                    if points:
                        current_objective['pointsAwarded'].extend(points)
            elif current_subheading == 'diceRange':
                if current_objective.get('diceRange'):
                    current_objective['diceRange'] += ' ' + text
                else:
                    current_objective['diceRange'] = text
            else:
                para_html = para_to_html(para)
                if current_objective.get(current_subheading):
                    current_objective[current_subheading] += '\n' + para_html
                else:
                    current_objective[current_subheading] = para_html
    if current_objective:
        objectives.append(current_objective)

    return objectives


def extract_objectives(docx_path: str = CORE_RULES_DOCX, output_path: str = OUTPUT_PATH) -> None:
    """
    Main extraction function.
    """
    print(f"\n{'='*60}")
    print(f"  Extracting Secondary Mission Objectives from Core Rules")
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
        
        # Find the objectives subsection
        objectives_paragraphs = get_section_paragraphs(
            doc,
            "Generating a Battle",
            "Optional Game Feature: Secondary Mission Objectives"
        )
        
        if not objectives_paragraphs:
            print("  ✗  ERROR: Could not find 'Secondary Mission Objectives' subsection")
            print("  DEBUG: Available headings under 'Generating a Battle':")
            log_section_headings(doc, "Generating a Battle")
            return False
        
        # Extract objective data from heading structure first
        objectives = extract_objectives_from_headings(objectives_paragraphs)
        if not objectives:
            print("  ✗  ERROR: No objectives found in headings")
            return False
        
        print(f"  Found {len(objectives)} objectives\n")
        
        # Generate TypeScript file
        ts_content = generate_typescript_file(objectives)
        
        # Write output
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(ts_content)
        
        print(f"  ✓  Wrote {len(objectives)} objectives to {output_path}")
        print(f"{'='*60}\n")
        return True
    
    except Exception as e:
        print(f"  ✗  ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


def generate_typescript_file(objectives: list) -> str:
    """Generate the TypeScript source code for objectives."""
    
    # Build the interfaces
    interfaces = """export interface ObjectivePoints {
  condition: string;
  points: number;
}

export interface SecondaryObjective {
  id: string;
  number: number;
  name: string;
  timing: string;
  description: string;
  pointsAwarded: ObjectivePoints[];
  theme?: string;
  diceRange?: string;
  gameEffects?: string;
}
"""
    
    # Build the data array
    data_lines = ["export const SECONDARY_OBJECTIVES: SecondaryObjective[] = ["]
    
    for obj in objectives:
        data_lines.append("  {")
        data_lines.append(f'    id: "{obj["id"]!s}",')
        data_lines.append(f'    number: {obj["number"]!s},')
        data_lines.append(f'    name: "{escape_string(obj["name"])}",')
        data_lines.append(f'    timing: "{escape_string(obj["timing"])}",')
        data_lines.append(f'    description: "{escape_string(obj["description"])}",')
        if obj.get('theme'):
            data_lines.append(f'    theme: "{escape_string(obj["theme"])}",')
        if obj.get('diceRange'):
            data_lines.append(f'    diceRange: "{escape_string(obj["diceRange"])}",')
        
        data_lines.append("    pointsAwarded: [")
        for point in obj['pointsAwarded']:
            data_lines.append("      {")
            data_lines.append(f'        condition: "{escape_string(point["condition"])}",')
            data_lines.append(f'        points: {point["points"]!s},')
            data_lines.append("      },")
        data_lines.append("    ],")
        
        if obj.get('gameEffects'):
            data_lines.append(f'    gameEffects: "{escape_string(obj["gameEffects"])}",')
        
        data_lines.append("  },")
    
    data_lines.append("];")
    
    header = f"""// Auto-generated by extract_objectives.py
// DO NOT EDIT MANUALLY — regenerate from Word document

"""
    
    return header + interfaces + "\n" + "\n".join(data_lines)


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
    success = extract_objectives(docx_path, out_path)
    sys.exit(0 if success else 1)
