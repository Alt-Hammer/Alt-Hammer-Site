#!/usr/bin/env python3
"""
fix_custodes.py
Fix special characters in adeptus-custodes.mdx
"""

def fix_file():
    filepath = 'src/content/factions/adeptus-custodes.mdx'

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace special characters
    replacements = {
        ''': "'",     # right single quote
        ''': "'",     # left single quote
        '"': '"',     # right double quote
        '"': '"',     # left double quote
        ''': "'",     # prime
        ''': '"',     # double prime
    }

    for old, new in replacements.items():
        content = content.replace(old, new)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    print("Fixed adeptus-custodes.mdx")

if __name__ == '__main__':
    fix_file()