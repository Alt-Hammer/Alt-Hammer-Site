"""
convert_faction_wargear.py
--------------------------
Parses faction-level Wargear Upgrades from the Faction Rules Index .docx and
writes structured JSON for every faction.

These are the faction-wide items (armour types, equipment, weapon modifiers,
vehicle upgrades) listed under each faction's H3: Wargear Upgrades section —
distinct from the per-unit wargear options parsed by convert_wargear.py.

OUTPUT
------
  src/data/faction-wargear/astra-militarum.json
  src/data/faction-wargear/adeptus-astartes.json
  ... (one file per faction)

USAGE
-----
  python scripts/convert_faction_wargear.py
  python scripts/convert_faction_wargear.py --faction astra-militarum
"""

import sys
import os
import re
import copy
import json
import argparse

script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from docx import Document
from ah_converter_utils import get_heading_level, slugify, ensure_dir, render_prose_html
# Shared weapon/wargear resolver (compound "A and B", Twin-linked cost, build-time
# points) — reused so sub-selection option lines resolve exactly like unit clauses.
from convert_options import Catalog, resolve_option

# ── Path configuration ────────────────────────────────────────────────────────

# Source document paths are centralised in source_paths.py — see that file
# to change where the documents live or what they are called.
from source_paths import FACTION_INDEX_DOCX
OUTPUT_DIR = "src/data/faction-wargear"
PUBLIC_DIR = os.path.join("public", "data", "faction-wargear")  # client-fetched copy

# ── Heading classification sets ───────────────────────────────────────────────

ALLIANCE_HEADERS = {
    'the imperium', 'forces of chaos', 'the aeldari', 'aeldari',
    'the great devourer', 'xenos', 'broader xenos',
    'introduction', 'table of contents',
}
H3_WARGEAR = {'wargear upgrades', 'wargear options', 'wargear'}

# Any other H3 under a faction is a selectable-upgrade CATALOG block (Gifts of Chaos,
# Paths of the Aspect Shrines) — the same authoring shape as Wargear Upgrades (H6 name +
# tab + cost, then prose), but the items are priced by the workbook catalog rather than
# here. We harvest them for their prose so the rules text has somewhere to live: it feeds
# the ref tooltips and, via convert_upgrades, the catalog items the List Builder renders.
H3_NON_CATALOG = H3_WARGEAR | {
    'army rules', 'army rule', 'detachment traits', 'detachment abilities',
    'detachment rules', 'unit profiles', 'units',
}


# ── Text helpers ──────────────────────────────────────────────────────────────

def clean(text) -> str:
    return (
        str(text or '').strip()
        .replace('‘', "'").replace('’', "'")
        .replace('“', '"').replace('”', '"')
        .replace('–', '-').replace('—', '-')
        .replace(' ', ' ')
    )


def parse_cost(raw: str) -> tuple:
    """
    Parse a tab-separated cost string (right side of H6 "Name\tCost").
    Returns (pointsCost: int|None, costNote: str|None).

    Examples:
      '10 Points'               -> (10,   None)
      '10 points per model'     -> (10,   'per model')
      '10 points per weapon'    -> (10,   'per weapon')
      '-10 Points per model'    -> (-10,  'per model')
      'Varies (see below)'      -> (None, 'varies')
      '5 Points (plus Weapon cost)' -> (5, 'plus weapon cost')
    """
    raw = raw.strip()
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*[Pp]oints?', raw)
    if not m:
        # No numeric cost found
        note = re.sub(r'\(.*?\)', '', raw).strip().lower() or None
        return (None, note if note else 'varies')

    pts_val = float(m.group(1))
    pts     = int(pts_val) if pts_val == int(pts_val) else pts_val

    # Strip the numeric+points part from the string to isolate note
    remainder = raw[m.end():].strip()
    remainder = re.sub(r'^\s*per\s+', '', remainder, flags=re.I)
    remainder = re.sub(r'^\(', '', remainder).rstrip(')').strip()
    note = remainder.lower() if remainder else None
    return (pts, note if note else None)


# ── Sub-selection extraction (combi weapons, turrets, warsuits, sponsons) ──────
# A wargear item may expose one or more independent sub-selection GROUPS
# ("...must/can be equipped with N of the following [label]: <option lines>"),
# an optional per-item INSTANCES multiplier ("...2 or 4 Sponsons...identical
# selections"), and a SUPPRESSION flag (an item that replaces the unit's normal
# Ranged/Melee weapon options). Option lines are resolved to full option objects
# (ref/name/points/parts/and) via the shared convert_options resolver, so compound
# "A and B" options and Twin-linked cost are handled deterministically at build time.

# A group intro is any line ending in ':' that names a quantity + "of the following"
# [label]. The verb is deliberately unconstrained so legacy combi phrasings ("...and
# any of the following additional Ranged weapons:") match alongside the standard
# "...must/can be equipped with N of the following [label]:".
GROUP_INTRO_RE = re.compile(
    r'(?P<q>up to\s+\d+|any(?:\s+number\s+of)?|\d+|an?)\s+of the following\b'
    r'(?:\s+(?P<label>[^:]+?))?\s*:\s*$', re.I)

# Restriction/exclusion intros ("...cannot be selected by models equipped with any
# of the following Wargear Upgrades:") look like a group intro but are NOT selectable.
EXCLUSION_RE = re.compile(r'\bcannot\b|\bnot be\b|\bexcluding\b', re.I)

# "…can replace its <weapon> with N of the following:" — the group replaces a named
# standard weapon (its cost is subtracted and it's shown as replaced in the loadout).
REPLACE_PREFIX_RE = re.compile(r'\breplace (?:its|their)\s+(?P<weap>.+?)\s+with\b', re.I)

# "...2 or 4 Super-heavy Sponsons." — a per-item quantity multiplier.
INSTANCES_RE = re.compile(r'\b(\d+)\s+or\s+(\d+)\s+([A-Za-z][A-Za-z\- ]*?)\s*[.,]', re.I)

# Item-agnostic: any item whose prose says it replaces the unit's weapon options.
SUPPRESS_RE = re.compile(
    r'do(?:es)?\s+not\s+select\s+ranged\s+and\s+melee\s+weapon\s+options', re.I)


def _group_pick(line, q):
    """Cardinality for one sub-selection group from its intro verb + quantity token."""
    q = q.strip().lower()
    must = re.search(r'\bmust\b', line, re.I) is not None
    if q.startswith('any'):
        pick = {'min': 0, 'max': None}
    elif 'up to' in q:
        pick = {'min': 0, 'max': int(re.search(r'\d+', q).group())}
    elif re.search(r'\d+', q):
        n = int(re.search(r'\d+', q).group())
        pick = {'min': n if must else 0, 'max': n}
    else:                                              # 'a' / 'an'
        pick = {'min': 1 if must else 0, 'max': 1}
    if re.search(r'but can only select 1 of each', line, re.I):
        pick['distinct'] = True
    return pick


def _clean_label(lbl):
    if not lbl:
        return ''
    lbl = re.sub(r'\s*\(.*?\)\s*', ' ', lbl)           # drop parentheticals
    return re.sub(r'\s+', ' ', lbl).strip().rstrip(':').strip()


def extract_sub_selections(effects, cat, ctx, warnings):
    """Parse an item's effect lines into ordered sub-selection groups.

    Each group opens on an intro line ("...N of the following [label]:") and
    collects the following resolvable option lines until the next intro, a full
    sentence (trailing '.'), or an unresolvable line. Returns a list of
    { id, label, pick:{min,max[,distinct]}, options:[{ref,name,kind,qty,
    modifiers,points,parts,and}] } — empty when the item has no sub-selections.
    """
    groups, cur = [], None
    for raw in effects:
        e = clean(raw)
        if not e:
            continue
        m = GROUP_INTRO_RE.search(e)
        if m and e.rstrip().endswith(':') and not EXCLUSION_RE.search(e):
            label = _clean_label(m.group('label'))
            cur = {'id': slugify(label) if label else '', 'label': label,
                   'pick': _group_pick(e, m.group('q')), 'options': []}
            rep = REPLACE_PREFIX_RE.search(e)   # "…replace its <weapon> with N of the following:"
            if rep:
                cur['replaces'] = re.sub(r'\s*\*+\s*$', '', clean(rep.group('weap'))).strip()
            groups.append(cur)
            continue
        if cur is None:
            continue                                   # prose before any group
        if INCLUDED_RE.match(e):                        # 'Are equipped with X' → included weapon, not an option
            cur = None
            continue
        # Prose guard FIRST: a full sentence (trailing '.') or a long phrase is not an
        # option line, even when it happens to mention a weapon/wargear name that
        # resolve_option would partially match. Ends the open group.
        if e.rstrip().endswith('.') or len(e.split()) > 8:
            cur = None
            continue
        opt = resolve_option(e, cat, ctx, [])
        if opt is not None:
            cur['options'].append({
                'ref': opt['ref'], 'name': opt['name'], 'kind': opt['kind'],
                'qty': opt.get('qty', 1), 'modifiers': opt.get('modifiers', []),
                'points': opt.get('points'), 'parts': opt.get('parts'),
                'and': opt.get('and', []),
            })
            continue
        # A short unresolved fragment is a rules-text option kept as 'see rules' (legacy combi).
        warnings.append(f"{ctx}: unresolved sub-selection option kept as 'see rules': {e!r}")
        cur['options'].append({'ref': 'custom:' + slugify(e), 'name': e, 'kind': 'custom',
                               'qty': 1, 'modifiers': [], 'points': None,
                               'parts': [{'text': e}], 'and': []})
    groups = [g for g in groups if g['options']]
    seen = {}                                          # make ids unique (blank/dup labels)
    for i, g in enumerate(groups):
        base = g['id'] or f"group-{i + 1}"
        if base in seen:
            seen[base] += 1
            g['id'] = f"{base}-{seen[base]}"
        else:
            seen[base] = 1
            g['id'] = base
    return groups


def extract_instances(effects):
    """A per-item quantity multiplier: '...2 or 4 X...identical selections' →
    { counts:[2,4], label:'X', identical:True }, else None."""
    for raw in effects:
        e = clean(raw)
        if 'identical' not in e.lower():
            continue
        m = INSTANCES_RE.search(e)
        if m:
            return {'counts': sorted({int(m.group(1)), int(m.group(2))}),
                    'label': re.sub(r'\s+', ' ', m.group(3)).strip(),
                    'identical': True}
    return None


def extract_suppresses(effects):
    """True if the item replaces the unit's normal Ranged/Melee weapon options."""
    return any(SUPPRESS_RE.search(clean(e)) for e in effects)


# "<subject> is/are equipped with <weapon>" — a compulsory weapon auto-included with the
# item (no choice). Its cost is added on top of the item. Two authoring voices are in use
# and both are recognised, because the same item is written either way across factions —
# the Dozer Blade Mount is "Models equipped with a Dozer Blade Mount: / Are equipped with
# a Dozer Blade" in three factions and "The bearer: / Is equipped with a Dozer Blade" in
# a fourth. The subject, when present, names the bearer, the models carrying the item, or
# the item itself ("The Wartrike is equipped with …"); an absent subject inherits the
# item's own "The bearer:" header.
#
# The `is|are` is what keeps this off the many conditional lines that also say "equipped
# with" — "cannot be equipped with", "can only be equipped with", "Models equipped with a
# Jump Pack cannot …" all lack it, and the ^ anchor stops a mid-sentence match.
INCLUDED_RE = re.compile(
    r'^\s*(?:'
      r'(?:the\s+)?bearer\s+'                     # "The bearer is equipped with …"
      r'|models?\s+equipped\s+with\s+.+?\s+'      # "Models equipped with a Hellion Board are …"
      r'|the\s+\S+(?:\s+\S+)??\s+'                # "The Wartrike is equipped with …"
    r')?'
    r'(?:is|are)\s+equipped\s+with\s+'
    r'(?!.*\bof the following\b)'                # not "…with a Boltgun and 1 of the following:"
    r'(?P<items>.+?)\.?\s*$', re.I)

# "…are equipped with the following" — the weapons are the lines that follow, not this one.
INCLUDED_LIST_RE = re.compile(r'^(?:the\s+)?following:?$', re.I)


def _resolve_included(nm, cat, ctx, warnings):
    """One included-weapon entry from a raw name. Resolved like an option line, so
    compounds ("1 Snazzy Shoota and 1 Killa Jet"), articles and Twin-linked all work.
    An unresolved name is kept name-only (shown 'included', uncosted) so the item
    still displays it."""
    # strip a leading "the" and a trailing "Melee/Ranged weapon" descriptor so
    # "the Dozer Blade Melee weapon" resolves to the weapon "Dozer Blade".
    nm = re.sub(r'^the\s+', '', nm.strip(), flags=re.I)
    nm = re.sub(r'\s+(?:melee|ranged)\s+weapons?$', '', nm, flags=re.I).strip()
    if not nm:
        return None
    opt = resolve_option(nm, cat, ctx, [])
    if opt is not None:
        return {'ref': opt['ref'], 'name': opt['name'], 'kind': opt['kind'],
                'qty': opt.get('qty', 1), 'modifiers': opt.get('modifiers', []),
                'points': opt.get('points'), 'parts': opt.get('parts'), 'and': opt.get('and', [])}
    warnings.append(f"{ctx}: included weapon did not resolve (name only, uncosted): {nm!r}")
    return {'ref': 'weapon:' + slugify(nm), 'name': nm, 'kind': 'weapon',
            'qty': 1, 'modifiers': [], 'points': None, 'parts': [{'text': nm}], 'and': []}


def extract_included_weapons(effects, cat, ctx, warnings):
    """Parse compulsory-weapon lines into auto-included weapons. A line naming its
    weapons inline yields them directly; one ending "…equipped with the following"
    takes the weapons from the lines beneath it, stopping at the first line that is
    prose or does not resolve."""
    out, pending_list = [], False
    for raw in effects:
        e = clean(raw)
        m = INCLUDED_RE.match(e)
        if m:
            items = m.group('items').strip()
            if INCLUDED_LIST_RE.match(items):     # weapons follow on their own lines
                pending_list = True
                continue
            pending_list = False
            w = _resolve_included(items, cat, ctx, warnings)
            if w:
                out.append(w)
            continue
        if not pending_list:
            continue
        # Collecting a "the following" list: take short, resolvable weapon lines and
        # stop at the first sentence or unresolved name, so ordinary prose beneath the
        # list is never swallowed.
        if not e or e.rstrip().endswith('.') or e.rstrip().endswith(':') or len(e.split()) > 6:
            pending_list = False
            continue
        opt = resolve_option(re.sub(r'^the\s+', '', e, flags=re.I), cat, ctx, [])
        if opt is None:
            pending_list = False
            continue
        out.append({'ref': opt['ref'], 'name': opt['name'], 'kind': opt['kind'],
                    'qty': opt.get('qty', 1), 'modifiers': opt.get('modifiers', []),
                    'points': opt.get('points'), 'parts': opt.get('parts'), 'and': opt.get('and', [])})
    return out


# "…weapon … can be upgraded to a [Modifier]" — a per-weapon upgrade offered on the
# item's own sub-selection weapons (e.g. Paragon Warsuit → Relic Weapon on a Leader).
RELIC_UPGRADE_RE = re.compile(
    r'\bweapon\b.*?\bcan be upgraded\s+(?:to|as)\s+(?:an?\s+)?(?P<mod>.+?)\.?\s*$', re.I)


def extract_relic_upgrade(effects, cat):
    """Parse an item-level 'any eligible weapon … can be upgraded to a <Modifier>'
    sentence into { modifier, modifierRef, pointsPerWeapon, excludeKeyword,
    requiresLeader } so the engine can offer it on the item's sub-selection weapons.
    pointsPerWeapon is resolved from the modifier's faction-wargear item (same source
    as the unit-level Relic Weapon clause). Grenades are excluded by default."""
    for raw in effects:
        e = clean(raw)
        m = RELIC_UPGRADE_RE.search(e)
        if not m:
            continue
        mod = re.sub(r'\s*\*+\s*$', '', m.group('mod')).strip()
        kind, ent = cat.lookup(mod)
        ex = re.search(r'excluding\s+(?:weapons with the\s+)?(\w+)', e, re.I)
        return {
            'modifier': mod,
            'modifierRef': (f"{kind}:{slugify(ent['name'])}" if ent else None),
            'pointsPerWeapon': (ent['points'] if ent else None),
            'excludeKeyword': (ex.group(1) if ex else 'Grenade'),
            'requiresLeader': bool(re.search(r'\bleader\b', e, re.I)),
        }
    return None


# ── Canonical weapon-modifier mechanics ───────────────────────────────────────
# Twin-linked is a universal rule, but each faction's wargear section states it in
# prose only, so `mechanics` is derived per faction and most sections don't yield
# rows. Without rows a weapon modifier is invisible to both the points resolver
# (scripts/convert_options.py) and the tooltip resolver (public/js/weapon-mods.js).
# These canonical rows are therefore backfilled onto any item that declares the rule
# in `effects` but produced no weapon-domain mechanics. Authored mechanics always
# win — backfill only ever fills a gap, never overwrites.
CANONICAL_WEAPON_MODIFIERS = {
    'twin-linked': [
        {'target': {'eligibility': [], 'domain': 'weapon',
                    'filter': {'kind': 'weaponStat',
                               'values': [{'char': 'S', 'cmp': '<', 'value': 9}]}},
         'modelStats': [], 'weaponStats': [{'char': 'A', 'op': 'inc', 'value': 1}],
         'keywords': {'add': ['Sustained Hits 1'], 'remove': []},
         'points': {'op': 'mult', 'value': 1.5}},
        {'target': {'eligibility': [], 'domain': 'weapon',
                    'filter': {'kind': 'weaponStat',
                               'values': [{'char': 'S', 'cmp': '>=', 'value': 9}]}},
         'modelStats': [], 'weaponStats': [{'char': 'A', 'op': 'inc', 'value': 1}],
         'keywords': {'add': ['Sustained Hits 1'], 'remove': []},
         'points': {'op': 'mult', 'value': 2}},
        {'target': {'eligibility': [], 'domain': 'weapon',
                    'filter': {'kind': 'weaponKeyword', 'values': ['Torrent']}},
         'modelStats': [], 'weaponStats': [{'char': 'A', 'op': 'inc', 'value': 3}],
         'keywords': {'add': [], 'remove': []},
         'points': {'op': 'mult', 'value': 1.5}},
    ],
}


def backfill_weapon_modifiers(items):
    """Fill in canonical weapon-domain mechanics for modifier items that declare the
    rule in prose but carry no derived rows. Returns the number of items patched."""
    patched = 0
    for it in items:
        rows = CANONICAL_WEAPON_MODIFIERS.get(it.get('itemId'))
        if not rows:
            continue
        existing = [r for r in ((it.get('mechanics') or {}).get('rows') or [])
                    if (r.get('target') or {}).get('domain') == 'weapon']
        if existing:
            continue                      # authored/derived mechanics win
        mech = it.setdefault('mechanics', {'rows': []})
        mech.setdefault('rows', []).extend(copy.deepcopy(rows))
        patched += 1
    return patched


# ── Main conversion ───────────────────────────────────────────────────────────

def convert_faction_wargear(
    docx_path: str,
    output_dir: str,
    faction_filter=None,
):
    print("")
    print("=" * 60)
    print("  Countermarch -- Converting Faction Wargear Upgrades")
    print("=" * 60)
    print(f"  Source:  {docx_path}")
    print(f"  Output:  {output_dir}")
    if faction_filter:
        print(f"  Filter:  {faction_filter}")
    print("=" * 60)
    print("")

    if not os.path.exists(docx_path):
        print(f"  ERROR: Source file not found:\n     {docx_path}")
        sys.exit(1)

    doc        = Document(docx_path)
    paragraphs = doc.paragraphs

    # -- Locate faction boundaries -------------------------------------------
    faction_spans = []
    for i, para in enumerate(paragraphs):
        text  = clean(para.text)
        level = get_heading_level(para)
        if level == 2 and text.lower() not in ALLIANCE_HEADERS:
            faction_spans.append((text, i))

    faction_ranges = []
    for idx, (name, start) in enumerate(faction_spans):
        end = faction_spans[idx + 1][1] if idx + 1 < len(faction_spans) else len(paragraphs)
        faction_ranges.append((name, start, end))

    print(f"  Found {len(faction_ranges)} factions")
    print("")

    written = 0

    for faction_name, fstart, fend in faction_ranges:
        faction_slug = slugify(faction_name)

        if faction_filter and faction_slug != faction_filter:
            continue

        print(f"  Processing: {faction_name}  ({faction_slug})")

        faction_paras = paragraphs[fstart + 1 : fend]

        # -- Locate the Wargear Upgrades H3 + any catalog H3 sections --------
        wargear_paras   = []
        catalog_blocks  = []          # [(category_title, [paras])]
        target          = None        # the list currently being filled

        for para in faction_paras:
            text  = clean(para.text)
            level = get_heading_level(para)

            if level in (1, 2):
                target = None
                continue
            if level == 3:
                low = text.lower()
                if low in H3_WARGEAR:
                    target = wargear_paras
                elif low in H3_NON_CATALOG or low in ALLIANCE_HEADERS:
                    target = None
                else:
                    catalog_blocks.append((text, []))
                    target = catalog_blocks[-1][1]
                continue
            if target is not None:
                target.append(para)

        # -- Parse wargear items from the section ----------------------------
        cat            = Catalog(faction_slug)   # weapon/wargear lookup for sub-selections
        sub_warnings   = []

        def parse_item_block(block_paras):
            """Parse one H3 block (Wargear Upgrades, or a catalog) into items. The
            authoring shape is identical: H6 `Name<tab>N Points`, then prose bullets."""
            items          = []
            current_cat    = None   # H5 category heading text (optional)
            current_item   = None
            current_effects= []
            current_paras  = []     # the same body paragraphs, for the rich render

            def flush_item():
                nonlocal current_item, current_effects, current_paras
                if current_item is None:
                    return
                item = {**current_item, 'effects': current_effects}
                # Reader-facing prose: same paragraphs, but keeping the bullet/paragraph
                # structure and the keyword/weapon/wargear spans that `effects` drops.
                html = render_prose_html(current_paras)
                if html:
                    item['effectsHtml'] = html
                ctx  = f"[{faction_slug}/{current_item['name']}]"
                subs = extract_sub_selections(current_effects, cat, ctx, sub_warnings)
                if subs:
                    item['subSelections'] = subs
                inst = extract_instances(current_effects)
                if inst:
                    item['instances'] = inst
                if extract_suppresses(current_effects):
                    item['suppressesWeaponOptions'] = True
                relic = extract_relic_upgrade(current_effects, cat)
                if relic:
                    item['relicUpgrade'] = relic
                inc = extract_included_weapons(current_effects, cat, ctx, sub_warnings)
                if inc:
                    item['includedWeapons'] = inc
                items.append(item)
                current_item   = None
                current_effects= []
                current_paras  = []

            for para in block_paras:
                text  = clean(para.text)
                level = get_heading_level(para)

                if not text:
                    continue

                if level in (1, 2, 3):
                    flush_item()
                    break

                if level == 4:
                    flush_item()
                    current_cat = text
                    continue

                if level == 5:
                    flush_item()
                    current_cat = text
                    continue

                if level == 6:
                    flush_item()
                    if '\t' in text:
                        name_part, cost_part = text.split('\t', 1)
                    else:
                        name_part, cost_part = text, ''
                    name_part = name_part.strip()
                    pts, note = parse_cost(cost_part) if cost_part else (None, None)
                    current_item = {
                        'itemId':    slugify(name_part),
                        'name':      name_part,
                        'pointsCost': pts,
                        'costNote':  note,
                        'category':  current_cat,
                    }
                    current_effects = []
                    current_paras   = []
                    continue

                if level in (7, 8):
                    # Sub-entries under an item — treat as effect bullet
                    if current_item is not None:
                        current_effects.append(text)
                        current_paras.append(para)
                    continue

                # Body paragraph
                if current_item is not None:
                    current_effects.append(text)
                    current_paras.append(para)

            flush_item()
            return items

        items = parse_item_block(wargear_paras)
        # Catalog blocks: same shape, but the workbook prices them — keep only identity
        # and prose here, tagged with the catalog Category so convert_upgrades can join.
        catalog_items = []
        for cat_title, cat_paras in catalog_blocks:
            for it in parse_item_block(cat_paras):
                it['catalogCategory'] = cat_title
                catalog_items.append(it)

        # -- Report ----------------------------------------------------------
        cats = {i['category'] for i in items if i['category']}
        sub_items = sum(1 for i in items if i.get('subSelections'))
        print(f"    Wargear items   : {len(items)}")
        if cats:
            print(f"    Categories      : {', '.join(sorted(cats))}")
        else:
            print(f"    Categories      : (none — flat list)")
        if sub_items:
            print(f"    Sub-selections  : {sub_items} item(s) with option groups")
        if catalog_items:
            print(f"    Catalog prose   : {len(catalog_items)} item(s) from "
                  f"{', '.join(sorted({i['catalogCategory'] for i in catalog_items}))}")
        for w in sub_warnings:
            print(f"    ~ {w}")

        # -- Write JSON ------------------------------------------------------
        backfill_weapon_modifiers(items)
        output = {
            'faction':      faction_name,
            'slug':         faction_slug,
            'wargearItems': items,
        }
        # Kept OUT of wargearItems on purpose: these are priced by the catalog, and
        # letting convert_options resolve `wargear:path-of-asurmen` would make a Path
        # takeable as ordinary wargear and billed twice.
        if catalog_items:
            output['catalogItems'] = catalog_items
        output_path = os.path.join(output_dir, f"{faction_slug}.json")
        ensure_dir(output_dir)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        ensure_dir(PUBLIC_DIR)   # mirror to the client-fetched copy
        with open(os.path.join(PUBLIC_DIR, f"{faction_slug}.json"), 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=2, ensure_ascii=False)
        print(f"    Written: {output_path}")
        print("")
        written += 1

    print("=" * 60)
    print(f"  Complete: {written} faction-wargear JSON file(s) written")
    print("=" * 60)
    print("")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Convert faction-level wargear upgrades to JSON'
    )
    parser.add_argument(
        '--faction', '-f',
        help='Slug of a single faction to process',
        default=None,
    )
    parser.add_argument('--docx',   default=FACTION_INDEX_DOCX)
    parser.add_argument('--output', default=OUTPUT_DIR)
    args = parser.parse_args()

    convert_faction_wargear(args.docx, args.output, args.faction)
