#!/usr/bin/env python3
"""
sanitize_mdx.py
Sanitize special characters in MDX files for compatibility.
"""

import os
import glob

def sanitize_text(text: str) -> str:
    """Replace special Unicode characters with ASCII equivalents."""
    replacements = {
        '\u2013': '-',     # en dash
        '\u2014': '-',     # em dash
        '\u2018': "'",     # left single quote
        '\u2019': "'",     # right single quote
        '\u201c': '"',     # left double quote
        '\u201d': '"',     # right double quote
        '\u2026': '...',   # ellipsis
        '\u2022': '*',     # bullet
    }
    
    for old, new in replacements.items():
        text = text.replace(old, new)
    
    return text

def sanitize_file(filepath: str):
    """Sanitize a single MDX file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        sanitized = sanitize_text(content)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(sanitized)
        
        print(f"Sanitized: {filepath}")
    except Exception as e:
        print(f"Error sanitizing {filepath}: {e}")

def main():
    """Sanitize all MDX files in the content directories."""
    patterns = [
        'src/content/**/*.mdx',
        'src/content/**/*.md',
    ]
    
    for pattern in patterns:
        for filepath in glob.glob(pattern, recursive=True):
            sanitize_file(filepath)

if __name__ == '__main__':
    main()