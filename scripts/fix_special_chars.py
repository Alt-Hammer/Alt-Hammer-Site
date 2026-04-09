#!/usr/bin/env python3
"""
fix_special_chars.py
Fix remaining special characters in MDX files.
"""

import os
import glob

def fix_special_chars(text: str) -> str:
    """Replace remaining special Unicode characters with ASCII equivalents."""
    replacements = {
        '\u00A0': ' ',    # non-breaking space
        '\u202F': ' ',    # narrow no-break space
        '\u200B': '',     # zero width space
        '\u200E': '',     # left-to-right mark
        '\u200F': '',     # right-to-left mark
        '\uFEFF': '',     # byte order mark
        '\u2018': "'",   # left single quotation mark
        '\u2019': "'",   # right single quotation mark / apostrophe
        '\u201A': "'",   # single low-9 quotation mark
        '\u201B': "'",   # single high-reversed-9 quotation mark
        '\u201C': '"',   # left double quotation mark
        '\u201D': '"',   # right double quotation mark
        '\u201E': '"',   # double low-9 quotation mark
        '\u201F': '"',   # double high-reversed-9 quotation mark
        '\u2032': "'",   # prime
        '\u2033': '"',   # double prime
        '\u2013': '-',    # en dash
        '\u2014': '-',    # em dash
        '\u2015': '-',    # horizontal bar
        '\u2026': '...',  # ellipsis
        '\u2022': '*',    # bullet
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    return text

def fix_file(filepath: str):
    """Fix special characters in a single file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        fixed = fix_special_chars(content)

        # Only write if there were changes
        if fixed != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(fixed)
            print(f"Fixed: {filepath}")
        else:
            print(f"No changes needed: {filepath}")
    except Exception as e:
        print(f"Error fixing {filepath}: {e}")

def main():
    """Fix all MDX files in the content directories."""
    patterns = [
        'src/content/**/*.mdx',
        'src/content/**/*.md',
    ]

    for pattern in patterns:
        for filepath in glob.glob(pattern, recursive=True):
            fix_file(filepath)

if __name__ == '__main__':
    main()