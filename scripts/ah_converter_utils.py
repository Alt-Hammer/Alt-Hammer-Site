"""
ah_converter_utils.py
─────────────────────
Shared utilities for the Alt-Hammer document conversion pipeline.

This module handles the core logic that all three conversion scripts share:
  - Detecting 'Keyword' and 'Action' character styles in python-docx runs
  - Converting a paragraph (with mixed styles) into Markdown text
  - Slugifying text for anchor links and file names
  - Writing output files safely

STYLE DETECTION
───────────────
python-docx exposes character styles on Run objects via run.style.name.
Your Word documents use two named character styles:
  - 'Keyword'  → rendered as gold small-caps on the website
  - 'Action'   → rendered as italic underlined on the website

Both are wrapped in <span class="keyword" data-term="slug"> on output,
with a data-type attribute to distinguish them for different tooltip styling.
"""

import re
import os
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn


# ── Character sanitization ────────────────────────────────────────────────────

def sanitize_text(text: str) -> str:
    """
    Replace special Unicode characters with ASCII equivalents for MDX compatibility.
    """
    replacements = {
        '–': '-',     # en dash
        '—': '-',     # em dash
        ''': "'",     # left single quote
        ''': "'",     # right single quote
        '"': '"',     # left double quote
        '"': '"',     # right double quote
        '…': '...',   # ellipsis
        '•': '*',     # bullet
        '°': ' degrees', # degree symbol
        '™': '(TM)',  # trademark
        '®': '(R)',   # registered
        '©': '(C)',   # copyright
    }
    
    for old, new in replacements.items():
        text = text.replace(old, new)
    
    return text


# ── Slug helpers ──────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """
    Convert display text to a URL-safe slug.
    'Feel No Pain 5+' → 'feel-no-pain-5'
    'Charge and Fight' → 'charge-and-fight'
    """
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)   # remove special chars except hyphens
    text = re.sub(r'[\s_]+', '-', text)     # spaces and underscores → hyphens
    text = re.sub(r'-+', '-', text)         # collapse multiple hyphens
    return text.strip('-')


def heading_to_anchor(text: str) -> str:
    """Convert a heading to an HTML anchor id."""
    return slugify(text)


# ── Style detection ───────────────────────────────────────────────────────────

def get_run_style_name(run) -> str | None:
    """
    Return the character style name applied to a run, or None.
    Checks both run.style (explicit style) and rStyle in XML (inline style).
    """
    # Method 1: explicit style object
    if run.style and run.style.name:
        name = run.style.name
        # Exclude paragraph-level styles that bleed through
        if name not in ('Default Paragraph Style', 'Normal', 'Default'):
            return name

    # Method 2: check raw XML for rStyle element
    rpr = run._r.find(qn('w:rPr'))
    if rpr is not None:
        rstyle = rpr.find(qn('w:rStyle'))
        if rstyle is not None:
            val = rstyle.get(qn('w:val'))
            if val:
                return val

    return None


def is_keyword_run(run) -> bool:
    """Return True if this run uses the 'Keyword' character style."""
    style = get_run_style_name(run)
    if style is None:
        return False
    return style.lower() in ('keyword', 'keyword1', 'keywords')


def is_action_run(run) -> bool:
    """Return True if this run uses the 'Action' character style."""
    style = get_run_style_name(run)
    if style is None:
        return False
    return style.lower() in ('action', 'action1', 'actions')


# ── Paragraph → Markdown conversion ──────────────────────────────────────────

def runs_to_markdown(paragraph) -> str:
    """
    Convert a paragraph's runs to a Markdown string, preserving:
      - Keyword style → <span class="keyword" data-term="slug" data-type="keyword">text</span>
      - Action style  → <span class="keyword" data-term="slug" data-type="action">text</span>
      - Bold          → **text**
      - Italic        → *text*
      - Underline     → (stripped — underline is part of Action style, handled above)
    
    Consecutive runs of the same style are merged before output.
    """
    parts = []
    
    for run in paragraph.runs:
        text = run.text
        if not text:
            continue

        # Sanitize special characters for MDX compatibility
        text = sanitize_text(text)

        if is_keyword_run(run):
            slug = slugify(text)
            parts.append(
                f'<span class="keyword" data-term="{slug}" data-type="keyword">{text}</span>'
            )
        elif is_action_run(run):
            slug = slugify(text)
            parts.append(
                f'<span class="keyword" data-term="{slug}" data-type="action">{text}</span>'
            )
        elif run.bold and run.italic:
            parts.append(f'***{text}***')
        elif run.bold:
            parts.append(f'**{text}**')
        elif run.italic:
            parts.append(f'*{text}*')
        else:
            parts.append(text)

    return ''.join(parts)


# ── Paragraph style classification ───────────────────────────────────────────

# Maps Word heading style names to Markdown heading levels
HEADING_STYLES = {
    'Heading 1': 1,
    'Heading 2': 2,
    'Heading 3': 3,
    'Heading 4': 4,
    'Heading 5': 5,
    'Heading 6': 6,
    'Heading 7': 7,
}

def get_heading_level(paragraph) -> int | None:
    """Return the heading level (1-7) or None if not a heading."""
    style_name = paragraph.style.name if paragraph.style else ''
    return HEADING_STYLES.get(style_name)


def is_list_paragraph(paragraph) -> bool:
    """Return True if this paragraph is a list item."""
    style_name = paragraph.style.name if paragraph.style else ''
    return 'List' in style_name or paragraph._p.find(qn('w:numPr')) is not None


def get_list_level(paragraph) -> int:
    """Return the list indentation level (0-based)."""
    numpr = paragraph._p.find(qn('w:numPr'))
    if numpr is not None:
        ilvl = numpr.find(qn('w:ilvl'))
        if ilvl is not None:
            return int(ilvl.get(qn('w:val'), 0))
    return 0


def is_numbered_list(paragraph) -> bool:
    """Return True if this is a numbered (ordered) list item."""
    style_name = paragraph.style.name if paragraph.style else ''
    return 'List Number' in style_name or 'List Paragraph' in style_name


# ── Document → Markdown section conversion ───────────────────────────────────

def paragraph_to_markdown(paragraph, list_counter: dict) -> str:
    """
    Convert a single paragraph to its Markdown equivalent.
    
    list_counter: dict tracking current number for ordered lists per level,
                  e.g. {0: 3, 1: 1} means level-0 item 3, level-1 item 1
    """
    text = runs_to_markdown(paragraph)
    
    if not text.strip():
        return ''

    heading_level = get_heading_level(paragraph)
    if heading_level is not None:
        prefix = '#' * heading_level
        # Reset list counters on any heading
        list_counter.clear()
        return f'\n{prefix} {text}\n'

    if is_list_paragraph(paragraph):
        level = get_list_level(paragraph)
        indent = '  ' * level

        if is_numbered_list(paragraph):
            n = list_counter.get(level, 0) + 1
            list_counter[level] = n
            # Reset deeper levels
            for k in list(list_counter.keys()):
                if k > level:
                    del list_counter[k]
            return f'{indent}{n}. {text}'
        else:
            return f'{indent}- {text}'

    # Reset list counter on non-list paragraph
    list_counter.clear()
    return text


def doc_to_markdown_sections(doc_path: str) -> list[dict]:
    """
    Parse a Word document and split it into sections by Heading 1.
    
    Returns a list of dicts:
      {
        'title': str,           # Heading 1 text
        'slug': str,            # slugified title
        'content': str,         # full Markdown content of this section
        'subsections': [str],   # list of Heading 2 titles found in section
      }
    """
    doc = Document(doc_path)
    sections = []
    current_section = None
    lines = []
    list_counter = {}

    for para in doc.paragraphs:
        level = get_heading_level(para)
        text = para.text.strip()

        if not text:
            if lines and lines[-1] != '':
                lines.append('')
            continue

        if level == 1:
            # Save current section
            if current_section is not None:
                current_section['content'] = '\n'.join(lines).strip()
                sections.append(current_section)

            # Start new section
            current_section = {
                'title': text,
                'slug': slugify(text),
                'content': '',
                'subsections': [],
            }
            lines = []
            list_counter = {}

        else:
            if level == 2 and current_section is not None:
                current_section['subsections'].append(text)

            md_line = paragraph_to_markdown(para, list_counter)
            if md_line:
                lines.append(md_line)

    # Save last section
    if current_section is not None:
        current_section['content'] = '\n'.join(lines).strip()
        sections.append(current_section)

    return sections


# ── File output helpers ───────────────────────────────────────────────────────

def ensure_dir(path: str):
    """Create directory if it doesn't exist."""
    Path(path).mkdir(parents=True, exist_ok=True)


def write_mdx_file(output_path: str, frontmatter: dict, content: str):
    """
    Write a .mdx file with YAML frontmatter and Markdown content.
    
    frontmatter: dict of key/value pairs written as YAML
    content: Markdown body text
    """
    ensure_dir(os.path.dirname(output_path))

    yaml_lines = ['---']
    for key, value in frontmatter.items():
        if isinstance(value, str):
            # Escape quotes in string values
            escaped = value.replace('"', '\\"')
            yaml_lines.append(f'{key}: "{escaped}"')
        elif isinstance(value, list):
            yaml_lines.append(f'{key}:')
            for item in value:
                yaml_lines.append(f'  - "{item}"')
        else:
            yaml_lines.append(f'{key}: {value}')
    yaml_lines.append('---')
    yaml_lines.append('')

    full_content = '\n'.join(yaml_lines) + '\n' + content + '\n'

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(full_content)

    print(f'  ✓  Written: {output_path}')


def write_json_file(output_path: str, data):
    """Write a JSON file with pretty formatting."""
    import json
    ensure_dir(os.path.dirname(output_path))
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'  ✓  Written: {output_path}')
