#!/usr/bin/env python3
"""
identify_unicode_in_mdx.py
Scan MDX/MD files and report non-ASCII Unicode characters by file and line.
"""

import glob
import unicodedata

TARGET_PATTERNS = [
    'src/content/**/*.mdx',
    'src/content/**/*.md',
]

def is_ascii(char: str) -> bool:
    return ord(char) < 128

def describe_char(char: str) -> str:
    code = ord(char)
    name = unicodedata.name(char, '<unknown>')
    return f"{char} (U+{code:04X}, {name})"


def scan_file(path: str):
    findings = []
    with open(path, 'r', encoding='utf-8') as f:
        for lineno, line in enumerate(f, start=1):
            non_ascii = [c for c in line if not is_ascii(c)]
            if non_ascii:
                unique = []
                for ch in non_ascii:
                    if ch not in unique:
                        unique.append(ch)
                findings.append((lineno, line.rstrip('\n'), unique))
    return findings


def main():
    any_findings = False
    for pattern in TARGET_PATTERNS:
        for path in sorted(glob.glob(pattern, recursive=True)):
            findings = scan_file(path)
            if findings:
                any_findings = True
                print(f"\n{path}")
                for lineno, text, chars in findings:
                    descriptions = ', '.join(describe_char(ch) for ch in chars)
                    print(f"  Line {lineno}: {descriptions}")
                    print(f"    {text}")
    if not any_findings:
        print("No non-ASCII Unicode characters found in MDX/MD content.")

if __name__ == '__main__':
    main()
