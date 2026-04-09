#!/usr/bin/env python3
"""
remove_heading_id_markers.py
Remove unsupported MDX heading anchor markers like {#slug} from generated files.
"""

import glob
import re

PATTERNS = [
    'src/content/**/*.mdx',
    'src/content/**/*.md',
]

HEADING_ID_RE = re.compile(r'(#{1,6}[^\n\r]*?)\s*\{#[^}]+\}')


def clean_file(path: str):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    cleaned = HEADING_ID_RE.sub(r'\1', content)

    if cleaned != content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(cleaned)
        print(f'Cleaned heading markers: {path}')
    else:
        print(f'No heading markers found: {path}')


def main():
    for pattern in PATTERNS:
        for path in sorted(glob.glob(pattern, recursive=True)):
            clean_file(path)

if __name__ == '__main__':
    main()
