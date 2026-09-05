#!/usr/bin/env python3
"""
source_paths.py — single definition of where the source documents live.

Every converter and extractor imports its document path from here rather than
declaring its own. Before this module the twelve scripts disagreed: nine
hard-coded the full "C:/Users/..." chain, three resolved it relative to the repo.
That split meant renaming the sources folder broke nine scripts and spared
three, and renaming the documents broke all twelve.

Layout this assumes (SOURCE_DIR is two levels above the repo root):

    <sources folder>/                  <- SOURCE_DIR, holds the .docx/.xlsx files
      +- <website folder>/
           +- <repo>/                  <- _REPO
                +- scripts/            <- this file

Because SOURCE_DIR is derived from this file's own location, renaming any of
those folders needs no edit here. Renaming the *documents* is a one-line change
to _EDITION below, provided the "<edition> - <name>" pattern is kept.
"""

import os

# Repo root: two levels up from this file (scripts/ -> repo).
_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The source documents live two levels above the repo root.
SOURCE_DIR = os.path.normpath(os.path.join(_REPO, "..", ".."))

# Shared filename prefix for all six documents.
_EDITION = "Countermarch 40,000 1st Edition"


def _doc(name):
    """Absolute, normalised path to a source document."""
    return os.path.normpath(os.path.join(SOURCE_DIR, f"{_EDITION} - {name}"))


# ── The six source documents ──────────────────────────────────────────────────

CORE_RULES_DOCX        = _doc("Core Rules.docx")
FACTION_INDEX_DOCX     = _doc("Faction Rules Index.docx")
UNIT_DATATABLES_XLSX   = _doc("Unit Data Tables by Faction.xlsx")
WEAPON_DATATABLES_XLSX = _doc("Weapon Data Tables by Faction.xlsx")
ROLL_TABLES_XLSX       = _doc("Hit and Wound Roll Tables.xlsx")
UPGRADES_XLSX          = _doc("Wargear Upgrades and Detachment Traits by Faction.xlsx")

ALL_SOURCES = {
    "Core Rules":        CORE_RULES_DOCX,
    "Faction Rules":     FACTION_INDEX_DOCX,
    "Unit Data":         UNIT_DATATABLES_XLSX,
    "Weapon Data":       WEAPON_DATATABLES_XLSX,
    "Roll Tables":       ROLL_TABLES_XLSX,
    "Wargear Upgrades":  UPGRADES_XLSX,
}


def check(verbose=True):
    """Report which source documents are present. Returns a list of missing ones."""
    missing = []
    for label, path in ALL_SOURCES.items():
        ok = os.path.isfile(path)
        if not ok:
            missing.append(label)
        if verbose:
            print(f"  [{'ok ' if ok else 'MISSING'}] {label:18s} {os.path.basename(path)}")
    return missing


if __name__ == "__main__":
    print(f"SOURCE_DIR = {SOURCE_DIR}\n")
    missing = check()
    print()
    print("All six source documents found." if not missing
          else f"MISSING: {', '.join(missing)}")
