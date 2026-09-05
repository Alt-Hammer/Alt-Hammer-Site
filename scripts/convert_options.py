"""
convert_options.py
==================
Deterministic grammar parser for per-unit options. Replaces convert_wargear.py.

Reads the Faction Rules Index .docx and, for each unit, parses the
Standard Wargear / Armour Options / Wargear Options / Force Organization H6
sections into the canonical unit-options schema defined in
docs/wargear-grammar.md. Merges unit stats/keywords/category/composition from
the existing src/data/units/{slug}.json (Excel-derived).

Design contract (docs/wargear-grammar.md):
  - The parser NEVER guesses. Every option sentence must match a grammar
    template (§3); every option name must resolve to a weapon/faction-wargear
    ref. Anything else is recorded as a HARD ERROR and the build fails
    (exit code 1) with faction / unit / section / line / text.

OUTPUT
------
  src/data/units/{slug}.json  is EXTENDED in place with an "options" object
  per unit:  { "forceOrg", "composition", "slots", "sections":[...] }
  (kept in the same file so the engine has one canonical record; the legacy
   wargear/ and unit-profiles/ files become redundant once the UI is migrated.)

USAGE
-----
  python scripts/convert_options.py --faction adeptus-astartes
  python scripts/convert_options.py            # all factions
"""

import os
import re
import sys
import json
import math
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docx import Document
from ah_converter_utils import (get_heading_level, runs_to_markdown, slugify, ensure_dir,
                                is_list_paragraph, get_run_style_name,
                                md_inline, render_prose_html)

# ── Path configuration (source files now live one level above the repo) ────────
# Source document paths are centralised in source_paths.py — see that file
# to change where the documents live or what they are called.
from source_paths import FACTION_INDEX_DOCX
UNITS_DIR = os.path.join("src", "data", "units")
FW_DIR    = os.path.join("src", "data", "faction-wargear")
CATALOG_DIR = os.path.join("src", "data", "upgrade-catalogs")
PUBLIC_UNITS_DIR = os.path.join("public", "data", "units")  # client-fetched copy

# ── Heading classification ─────────────────────────────────────────────────────
ALLIANCE_HEADERS = {
    'the imperium', 'forces of chaos', 'the aeldari', 'aeldari',
    'the great devourer', 'xenos', 'broader xenos', 'introduction',
    'table of contents',
}
H3_UNIT_PROFILES = {'units', 'unit profiles'}
H3_WARGEAR_UP    = {'wargear upgrades', 'wargear', 'wargear options'}
H3_OTHER         = {'army rules', 'army rule', 'detachment traits',
                    'detachment abilities', 'detachment rules'}

SEC_STANDARD = 'standardWargear'
SEC_ARMOUR   = 'armourOptions'
SEC_WARGEAR  = 'wargearOptions'
SEC_FORCE    = 'forceOrganization'
SEC_SPECIAL  = 'specialAbilities'
SEC_LEADER   = 'leader'
SEC_COMP     = 'unitComposition'
SEC_KEYCHAR  = 'keyCharacteristic'   # "key unit characteristic" selector (§3.8)
SEC_EXTRA    = 'additionalRules'     # free-form prose section, rendered under its own label

H6_MAP = {
    'standard wargear': SEC_STANDARD,
    'armour options':   SEC_ARMOUR,
    'wargear options':  SEC_WARGEAR,
    'force organization': SEC_FORCE,
    'force organisation': SEC_FORCE,
    'special abilities':  SEC_SPECIAL,
    'abilities':          SEC_SPECIAL,
    'leader':             SEC_LEADER,
    'led by':             SEC_LEADER,
    'unit composition':   SEC_COMP,
}
INTERACTIVE_SECTIONS = {SEC_STANDARD, SEC_ARMOUR, SEC_WARGEAR}

# An H6 heading that is none of the above is resolved, in order, as:
#   1. a catalog-backed key characteristic  (heading == an upgrade-catalog Category)
#   2. an inline key characteristic         (H7 option blocks follow)
#   3. a free-form prose section            (heading listed below)
#   4. a HARD ERROR
# Rule 4 is the point of the exercise: an unrecognised heading used to be dropped
# silently, which is how five whole rules and four `Abilities` typos went missing.
# A genuinely free-form prose heading is cheap to add here — a typo is not.
PROSE_ONLY_H6 = {
    'ridgehauler trailers',
    'asuryani psychic powers',
}

# Key-characteristic intro: "<subject> must/can select [up to] N of the following …".
# Searched anywhere in the paragraph so a leading flavour sentence ("Each Shard of
# Transcendent C'Tan is a shard of a specific god …") may precede it. `must` makes the
# selection compulsory (min = N); `can … up to` makes it optional (min = 0).
KEYCHAR_INTRO_RE = re.compile(
    r'\b(?P<mode>must|can)\s+select\s+(?:up\s+to\s+)?(?P<n>\d+)\s+of\s+the\s+following\b', re.I)
# H8 sub-block labels inside an inline key characteristic. Both `Abilities:` and
# `Special Abilities:` are in live use — accept either rather than send the author back
# to Word over a label.
KEYCHAR_H8 = {
    'wargear':           'wargear',
    'abilities':         'abilities',
    'special abilities': 'abilities',
    'leader':            'leader',
    'led by':            'leader',
}

# Slot label aliases → canonical slot
SLOT_ALIASES = [
    (r'primary ranged weapons?',       'primary-ranged'),
    (r'primary melee weapons?',        'primary-melee'),
    (r'secondary ranged weapons?',     'secondary-ranged'),
    (r'(?:additional )?secondary weapons?', 'secondary'),
]
ARMOUR_NAMES = {'tacticus armour', 'phobos armour', 'gravis armour',
                'terminator armour', 'scout armour', 'saturnine terminator armour'}


# ── Text helpers ───────────────────────────────────────────────────────────────
def clean(text) -> str:
    return (str(text or '').strip()
            .replace('‘', "'").replace('’', "'")
            .replace('“', '"').replace('”', '"')
            .replace('–', '-').replace('—', '-')
            .replace('\xa0', ' '))


def strip_footnote(name: str) -> str:
    return re.sub(r'\s*\*+\s*$', '', name).strip()


def parse_points(text: str):
    text = str(text).replace(',', '').lower()
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*points?', text)
    if m:
        v = float(m.group(1))
        return int(v) if v == int(v) else v
    return None


def label_to_slot(label: str):
    l = (label or '').strip().lower()
    for pat, slot in SLOT_ALIASES:
        if re.fullmatch(pat, l):
            return slot
    return None


# ── Lookups built per faction ──────────────────────────────────────────────────
class Catalog:
    """Slug-indexed weapon + faction-wargear lookup for ref resolution."""
    def __init__(self, slug):
        self.weapons = {}    # slug -> {name, points, strength}
        self.wargear = {}    # slug -> {name, points}
        up = os.path.join(UNITS_DIR, f"{slug}.json")
        if os.path.exists(up):
            data = json.load(open(up, encoding='utf-8'))
            for w in data.get('weapons', []):
                nm = (w.get('name') or '').strip()
                if not nm:
                    continue
                self.weapons[slugify(nm)] = {
                    'name': nm, 'points': w.get('points'),
                    'strength': _max_strength(w),
                    'keywords': [str(k).lower() for k in (w.get('keywords') or [])],
                    'section': (w.get('section') or '').lower(),   # 'ranged weapons' | 'melee weapons'
                }
        fwp = os.path.join(FW_DIR, f"{slug}.json")
        if os.path.exists(fwp):
            data = json.load(open(fwp, encoding='utf-8'))
            for it in data.get('wargearItems', []):
                nm = (it.get('name') or '').strip()
                if nm:
                    self.wargear[slugify(nm)] = {'name': nm, 'points': it.get('pointsCost'),
                                                 'mechanics': it.get('mechanics')}

        # Weapon-modifier items usable as a compulsory NAME PREFIX (§2.4a) — e.g.
        # "Twin-linked Accursed Heavy Bolter", "Relic Weapon Power Mace",
        # "Master-crafted Wheelgun". A modifier is any faction-wargear item carrying
        # weapon-domain mechanics rows (Twin-linked's rows are weapon-domain too). Keyed
        # by slug; multi-word names (Relic Weapon) are matched longest-first when
        # stripping. Priced by the same slug via flat_modifier_apply /
        # is_proportional_modifier, so adding a modifier is data only — no code here.
        # NOTE: relies on the workbook mechanics being merged first; run_all runs
        # convert_upgrades (Step 6b) before convert_options (Step 6c).
        self.modifiers = {slug: ent['name'] for slug, ent in self.wargear.items()
                          if _weapon_rows(ent)}

    def lookup(self, name):
        """Return (kind, entry) for a normalised name, or (None, None).
        Tries exact slug, then singular/plural variants."""
        s = slugify(name)
        for cand in (s, s.rstrip('s'), s + 's'):
            if cand in self.weapons:
                return 'weapon', self.weapons[cand]
            if cand in self.wargear:
                return 'wargear', self.wargear[cand]
        return None, None


def _max_strength(w):
    vals = []
    if w.get('strength') is not None:
        vals.append(w['strength'])
    for p in (w.get('profiles') or []):
        if p.get('strength') is not None:
            vals.append(p['strength'])
    out = []
    for v in vals:
        try:
            out.append(int(str(v).replace('+', '').strip()))
        except (ValueError, TypeError):
            pass
    return max(out) if out else None


def twin_linked_total(base_pts, strength):
    """Twin-linked's surcharge, tiered by the weapon's *effective* Strength (i.e. after
    any other modifier has been applied — see resolve order in `_resolve_single`) and
    compounding on the already-upgraded cost: S>=9 doubles, S<=8 adds half (round up).

    `strength` of None means the value is model-relative ('S', 'S +3') and cannot be
    resolved without a wielder; those fall through to the S<=8 tier, as they always have."""
    if base_pts is None:
        return None
    try:
        s = int(str(strength).replace('+', '').strip())
    except (ValueError, TypeError):
        s = 0
    return base_pts + (base_pts if s >= 9 else math.ceil(base_pts / 2))


def _weapon_rows(ent):
    """Weapon-domain mechanics rows of a faction-wargear entry."""
    return [r for r in (((ent or {}).get('mechanics') or {}).get('rows') or [])
            if (r.get('target') or {}).get('domain') == 'weapon']


def _banded_model_rows(ent):
    """Model-domain mechanics rows carrying a statline BAND. An item with these is priced
    per band — its pointsCost stays null ('varies') and the cost depends on the statline
    of the model taking it (Adrenal Glands: 5 pts at T<=3, 15 at T>=4)."""
    return [r for r in (((ent or {}).get('mechanics') or {}).get('rows') or [])
            if (r.get('target') or {}).get('domain') == 'model'
            and ((r.get('target') or {}).get('filter') or {}).get('kind') == 'modelBand']


def warn_banded_on_mixed_unit(unit_name, comp, sections, cat):
    """Flag a banded item offered per-model on a unit with several model types. Such a
    clause records only a COUNT of models that took the item, never WHICH ones, so the
    band — and with it the price — is ambiguous. The builder charges the dearest matching
    tier there (never undercharges); rephrasing the source as 'Every model in the unit …'
    or naming a model type resolves it exactly."""
    types = (comp or {}).get('modelTypes') or []
    if len(types) < 2:
        return
    seen = set()
    for sec in sections:
        for cl in (sec.get('clauses') or []):
            scope = cl.get('scope') or {}
            if scope.get('who') == 'unit' or scope.get('modelType') or cl.get('op') == 'fixed':
                continue                      # unambiguous: every model, or a named type
            for o in (cl.get('options') or []):
                for p in (o.get('parts') or [o]):
                    ref = p.get('ref') or ''
                    if not ref.startswith('wargear:'):
                        continue
                    ent = cat.wargear.get(ref.split(':', 1)[1].split('#')[0])
                    if not _banded_model_rows(ent) or ent['name'] in seen:
                        continue
                    seen.add(ent['name'])
                    WARNINGS.append(
                        f"{unit_name}: '{ent['name']}' is priced by model statline band, but "
                        f"clause {cl.get('id')} targets individual models on a unit with "
                        f"{len(types)} model types — the tier is ambiguous, so the builder "
                        f"charges the dearest matching one")


def is_proportional_modifier(cat, mod):
    """True for a modifier whose cost scales with the weapon it upgrades
    (`points.op: "mult"` — today only Twin-linked). These resolve LAST, so the tier
    is chosen against the weapon's effective Strength and the surcharge compounds on
    the already-upgraded cost. public/js/weapon-mods.js applies the identical rule."""
    _, ent = cat.lookup(mod)
    return any((r.get('points') or {}).get('op') == 'mult' for r in _weapon_rows(ent))


def _filter_matches(filt, entry):
    """Evaluate a mechanics row's target.filter against a catalog weapon entry.
    Mirrors the runtime matcher in public/js/weapon-mods.js."""
    if not filt:
        return True
    kind, values = filt.get('kind'), (filt.get('values') or [])
    if kind == 'weaponClass':
        section = entry.get('section') or ''
        return any(str(v).lower() in section for v in values)
    if kind == 'weaponKeyword':
        kws = entry.get('keywords') or []
        return any(any(k.startswith(str(v).lower()) for k in kws) for v in values)
    if kind == 'weaponStat':
        for cond in values:
            cur = entry.get('strength') if cond.get('char') == 'S' else None
            if cur is None:
                return False
            cmp_, val = cond.get('cmp'), cond.get('value')
            if cmp_ == '<' and not cur < val:
                return False
            if cmp_ == '<=' and not cur <= val:
                return False
            if cmp_ == '>' and not cur > val:
                return False
            if cmp_ == '>=' and not cur >= val:
                return False
            if cmp_ == '=' and not cur == val:
                return False
        return True
    return False


# Most specific matching row wins, NOT the first listed — see _pickRow in
# public/js/weapon-mods.js for why (Torrent vs the Strength-tier rows).
_SPECIFICITY = {'weaponKeyword': 3, 'weaponStat': 2, 'weaponClass': 1}


def _pick_row(rows, entry):
    best, best_rank = None, -1
    for row in rows:
        filt = (row.get('target') or {}).get('filter')
        if not _filter_matches(filt, entry):
            continue
        rank = _SPECIFICITY.get((filt or {}).get('kind'), 0) if filt else 0
        if rank > best_rank:
            best, best_rank = row, rank
    return best


def flat_modifier_apply(pts, entry, cat, mod):
    """Apply one non-Twin-linked weapon modifier (e.g. Accursed, Relic Weapon) named by
    slug `mod`. Returns (points, entry') where entry' carries the modifier's weapon-domain
    stat deltas folded in, so a later Twin-linked tiers off the *upgraded* Strength.

    Cost and stat deltas both come from the faction-wargear item's `mechanics`, so a new
    weapon modifier needs no code here — only source data."""
    _, ent = cat.lookup(mod)
    if not ent:
        return pts, entry
    upd = dict(entry)
    row = _pick_row(_weapon_rows(ent), upd)
    if row is None and upd.get('strength') is None:
        # Model-relative Strength ('S', 'S +3') can't satisfy a Strength-tiered filter.
        # Tier as if S=0 — the lowest tier — which is what these melee weapons have
        # always been priced at, since twin_linked_total's int() parse fell through to 0.
        row = _pick_row(_weapon_rows(ent), dict(upd, strength=0))
    if row is None:
        if pts is not None and ent.get('points') is not None:
            pts = pts + ent['points']         # no matching row: fall back to the flat cost
        return pts, upd
    for eff in (row.get('weaponStats') or []):
        if eff.get('char') != 'S':
            continue                          # only Strength feeds a later tier decision
        cur = upd.get('strength')
        if cur is None:
            continue                          # model-relative Strength: nothing to tier on
        op, val = eff.get('op'), eff.get('value') or 0
        upd['strength'] = val if op == 'set' else cur + (val if op == 'inc' else -val)
    p = row.get('points') or {}
    if pts is not None and p:
        if p.get('op') == 'delta':
            pts = pts + (p.get('value') or 0)
        elif p.get('op') == 'mult':
            pts = math.ceil(pts * (p.get('value') or 1))
        elif p.get('op') == 'set':
            pts = p.get('value')
    return pts, upd


# ── Option name → ref resolution ───────────────────────────────────────────────
QTY_RE = re.compile(r'^\s*(?:up to\s+)?(\d+)\s*x?\s+', re.I)
ART_RE = re.compile(r'^\s*(?:an?|1)\s+(?=\S)', re.I)

# Component separators for a multi-item option line. Splits on ' and ' / ' with '
# AND on commas, so an Oxford-comma list — "1 A, 1 B, and 1 C" — resolves as a
# 3-item composite (one fixed swap giving several items). A comma may be trailed by
# 'and'/'or' (the Oxford ", and "), consumed as one separator so the final item does
# not carry a stray leading connective. Kept in a single capturing group so
# re.split preserves the separators for `parts[]` rendering.
_OPT_SEP = re.compile(r'(\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+with\s+)', re.I)


WARNINGS = []  # non-fatal notes (e.g. uncosted compound labels)


def resolve_option(raw, cat, ctx, errors):
    """Parse one option line into {ref, name, kind, qty, modifiers, points, and?}.
    Components are joined by ' and ' / ' with '. Records a hard error and returns
    None only if NO component resolves; uncosted label tokens (e.g. a turret name)
    are surfaced as warnings, not errors."""
    text = strip_footnote(clean(raw)).rstrip('.').strip()
    if not text:
        return None

    # Split on ' and ' / ' with ' / commas KEEPING the separators, so the UI can render
    # each component (weapon/wargear → its own tooltip) and the plain text (connectors,
    # "Nx", uncosted labels like a turret name) separately. `parts` is an ordered
    # list of {text} plain segments and {ref,name,kind,qty,modifiers} ref segments.
    #
    # Try the WHOLE line as ONE item first, so an item whose NAME contains a comma or a
    # connective — e.g. the Orks wargear upgrade "Bigga, Stronga, Tuffa" — resolves as a
    # single component instead of being split into non-resolving fragments. Only split
    # when the whole line does not resolve on its own.
    pieces = [text] if _resolve_single(text, cat) is not None else _OPT_SEP.split(text)
    parts, resolved, labels = [], [], []
    for piece in pieces:
        if piece is not None and _OPT_SEP.fullmatch(piece):
            parts.append({'text': piece})
            continue
        if not piece.strip():
            continue
        e = _resolve_single(piece, cat)
        if e:
            resolved.append(e)
            parts.append({'ref': e['ref'], 'name': e['name'], 'kind': e['kind'],
                          'qty': e.get('qty', 1), 'modifiers': e.get('modifiers', [])})
        else:
            labels.append(piece.strip())
            parts.append({'text': piece})

    if not resolved:
        errors.append(f"{ctx}: unresolved option name '{text}'")
        return None
    if labels:
        WARNINGS.append(f"{ctx}: uncosted compound label(s) {labels} in '{text}'")

    pts, ok = 0, True
    for r in resolved:
        if r['points'] is None:
            ok = False
        else:
            pts += r['points']
    primary = resolved[0]
    single = (len(resolved) == 1 and not labels)
    out = {'ref': primary['ref'],
           'name': primary['name'] if single else text,
           'kind': primary['kind'],
           'qty': primary.get('qty', 1),
           'modifiers': primary.get('modifiers', []),
           'points': pts if ok else None,
           'parts': parts}
    if len(resolved) > 1:
        out['and'] = [{'ref': r['ref'], 'name': r['name'], 'kind': r['kind'],
                       'points': r['points']} for r in resolved[1:]]

    # Unique selection key within a clause. Options that share a base weapon but
    # differ by quantity / modifier (e.g. "2x Storm Bolter" vs "2x Twin-linked
    # Storm Bolter") or are composites must not collide on `ref` — the engine and
    # UI key selections by `ref`. Tooltips use the per-component `parts` (kept
    # canonical), and combi detection only matches un-suffixed refs, so this is safe.
    suffix = ''
    if out['qty'] != 1:
        suffix += '#q' + str(out['qty'])
    if out['modifiers']:
        suffix += '#m-' + '+'.join(out['modifiers'])
    if 'and' in out:
        suffix += '#c-' + slugify(out['name'])
    if suffix:
        out['ref'] += suffix
    return out


def _match_modifier_prefix(text, cat, already):
    """Longest leading word-run of `text` that is a known weapon-modifier item
    (`cat.modifiers`, keyed by slug) and not already stripped. Returns
    (slug, remainder) or None. Always leaves at least one word for the base weapon,
    and tries the longest prefix first so multi-word "Relic Weapon" wins over "Relic"."""
    words = text.split()
    for k in range(len(words) - 1, 0, -1):     # leave ≥1 word for the weapon name
        cand = slugify(' '.join(words[:k]))
        if cand in cat.modifiers and cand not in already:
            return cand, ' '.join(words[k:]).strip()
    return None


def _resolve_single(raw, cat):
    """Resolve one weapon/wargear token. Returns a dict or None (no error)."""
    text = raw.strip()
    qty = 1
    m = QTY_RE.match(text)
    if m:
        qty = int(m.group(1))
        text = text[m.end():].strip()
    else:
        text = ART_RE.sub('', text).strip()

    # Compulsory weapon-name modifier prefixes — may stack, in either order (e.g.
    # "Twin-linked Accursed Heavy Bolter", "Master-crafted Wheelgun", "Relic Weapon
    # Power Mace"). Data-driven off cat.modifiers (any weapon-modifier item), longest
    # name first so "Relic Weapon" beats a bare "Relic". Each is stripped to reveal
    # the base weapon and adds its own cost to the weapon below. `modifiers` holds
    # slugs (used both as the render order and as the pricing lookup key).
    modifiers = []
    while True:
        hit = _match_modifier_prefix(text, cat, modifiers)
        if not hit:
            break
        mod_slug, text = hit
        modifiers.append(mod_slug)

    name = strip_footnote(text).strip()
    if not name:
        return None
    kind, entry = cat.lookup(name)
    if entry is None:
        return None

    pts = entry['points']
    if kind == 'weapon':
        # Resolve order is fixed, NOT the order the modifiers appear in the name:
        # flat modifiers apply first (each folding its Strength delta into the working
        # entry), then proportional ones (Twin-linked) — so the tier is chosen against
        # the weapon's *effective* Strength and the surcharge compounds on the upgraded
        # cost. `modifiers` keeps name order, which is what the UI renders.
        flat = [m for m in modifiers if not is_proportional_modifier(cat, m)]
        prop = [m for m in modifiers if is_proportional_modifier(cat, m)]
        working = entry
        for mod in flat + prop:
            pts, working = flat_modifier_apply(pts, working, cat, mod)
    if pts is not None and qty != 1:
        pts = pts * qty           # "Nx <item>" → cost is the per-item cost × N
    return {'ref': f"{kind}:{slugify(entry['name'])}", 'name': entry['name'],
            'kind': kind, 'qty': qty, 'modifiers': modifiers, 'points': pts}


# ── Subject parsing → scope ─────────────────────────────────────────────────────
def parse_subject(text):
    """Return (scope_dict, remainder_text) or (None, text) if no subject matched."""
    t = text.strip()

    m = re.match(r"for every (\d+) models?,?\s+(?:up to\s+)?(\d+)\s+([A-Za-z][\w' -]*?)\s+(can|must)\b", t, re.I)
    if m:
        return ({'who': 'ratio', 'modelType': _role(m.group(3)),
                 'ratio': {'perX': int(m.group(1)), 'n': int(m.group(2))}},
                t[m.start(4):])

    m = re.match(r"up to (\d+)\s+([A-Za-z][\w' -]*?)\s+(?:in the unit\s+)?(can|must)\b", t, re.I)
    if m:
        return ({'who': 'count', 'count': int(m.group(1)), 'modelType': _role(m.group(2))},
                t[m.start(3):])

    m = re.match(r"(?:the|1)\s+([A-Za-z][\w' -]*?)\s+(?:in the unit\s+)?(can|must)\b", t, re.I)
    if m and _role(m.group(1)).lower() not in ('model', 'unit'):
        return ({'who': 'count', 'count': 1, 'modelType': _role(m.group(1))},
                t[m.start(2):])

    # "Every/Each model (in the unit) CAN …" → uniform 'global' selection across ALL
    #   models (who:unit): if taken, every model gets it (cost × model count). This is
    #   the standard wording for a selection all models take. "Every/Each model … MUST …"
    #   stays per-model (compulsory standard wargear — each model chooses independently).
    #   Contrast "The unit can …" (below), which is a finite unit-level pool.
    m = re.match(r"(?:every|each) model(?: in (?:the|this) unit)?\s+(can|must)\b", t, re.I)
    if m:
        return ({'who': 'unit' if m.group(1).lower() == 'can' else 'each'}, t[m.start(1):])

    # "Any model" / "This model" / "it" → per-model. An optional "in the unit" /
    # "in this unit" qualifier may follow "Any model" (mirrors the "Every/Each model"
    # branch above) — e.g. "Any model in the unit can replace its Warscythe with 2 …".
    m = re.match(r'(?:any model(?: in (?:the|this) unit)?|this model|it)\s+(can|must)\b', t, re.I)
    if m:
        return ({'who': 'each'}, t[m.start(1):])

    # "Any [role] …" / "Every/Each [role] …" (role ≠ model) → per-model of a NAMED
    #   role (who:each + modelType). Deliberately NOT who:unit: there is no per-role
    #   "uniform" scope, and who:each keeps points correct on mixed-role units (cost
    #   scales per equipped model, and a role subject can't cost the whole unit — e.g.
    #   "Every Novitiate can …" must not bill the Sister Superior). The verb (can/must)
    #   still drives optional vs compulsory via `pick` downstream. Must sit AFTER the
    #   "every/each model" and "any model" branches so those keep who:unit / who:each.
    m = re.match(r"(?:any|every|each)\s+([A-Za-z][\w' -]*?)\s+(?:in (?:the|this) unit\s+)?(can|must)\b", t, re.I)
    if m and _role(m.group(1)).lower() not in ('model', 'unit'):
        return ({'who': 'each', 'modelType': _role(m.group(1))}, t[m.start(2):])

    # "The/This unit can/must …" → a finite unit-level upgrade POOL (who:unitPool):
    #   a numerically-bounded add for the whole unit (e.g. "The unit can be equipped
    #   with up to 2 Cherubin" = 2 Cherubin models total, NOT 1 per model), costed per
    #   selected item. Distinct from "Every model … can" (who:unit, uniform × models).
    #   A unit-level REPLACE (shared armour) is downgraded to who:unit by the caller.
    m = re.match(r'(?:this unit|the unit)\s+(can|must)\b', t, re.I)
    if m:
        return ({'who': 'unitPool'}, t[m.start(1):])

    return (None, t)


def _role(s):
    return re.sub(r'\s+', ' ', s.strip()).strip()


# Fixed standard-wargear subjects. Generic subjects equip the whole unit; a named
# "Every/Each <model-or-role>" subject equips only that model type — the standard way
# to frame compulsory wargear on units with more than one model type and/or role.
_FIXED_GENERIC_SUBJ = re.compile(
    r'^(?:every|each) model(?: in (?:the|this) unit)?$|^this model$|^the unit$', re.I)
_FIXED_NAMED_SUBJ = re.compile(r'^(?:every|each)\s+(.+)$', re.I)


def _fixed_subject_modeltype(subj):
    """Classify a '<subject> is equipped with' subject:
      generic (every/each model, this model, the unit)    -> None   (whole-unit scope)
      'Every/Each <X>' where X is a specific model/role    -> the role name (scoped)
      'The <Name>' (single model named by its own name)    -> None   (whole-unit scope)
      anything else                                        -> False (not fixed wargear)."""
    if _FIXED_GENERIC_SUBJ.match(subj):
        return None
    m = _FIXED_NAMED_SUBJ.match(subj)
    if m:
        role = _role(m.group(1))
        if role.lower() not in ('model', 'unit'):
            return role
    # "The <Name> is equipped with …" — a single-model character named by its own name
    # (e.g. "The Dark Apostle"). Equivalent to "This model"; equips the whole
    # (single-model) unit. Sits AFTER the "Every/Each <role>" branch so role-scoped
    # subjects still bind to their model type.
    if re.match(r'^the\s+\S', subj, re.I):
        return None
    return False


# ── replaces parsing ────────────────────────────────────────────────────────────
def parse_replaces(text):
    """text is what follows 'replace its/their '. Return ({slot|weapon|weapons}, list_intro?)."""
    # compound "A and B"
    if ' and ' in text.lower():
        names = [strip_footnote(p).strip() for p in re.split(r'\s+and\s+', text, flags=re.I)]
        return {'weapons': names}
    slot = label_to_slot(text)
    if slot:
        return {'slot': slot}
    if text.strip().lower() in ARMOUR_NAMES:
        return {'slot': 'armour', 'weapon': strip_footnote(text).strip()}
    return {'weapon': strip_footnote(text).strip()}


# ── Clause classification (verb/predicate after subject) ───────────────────────
# ── Compound category-filtered replacement ("with 1 Pistol and 1 Melee weapon …") ──
def _parse_compound_segments(spec):
    """'1 Pistol and 1 Melee weapon' → [{'n':1,'cat':'Pistol'},{'n':1,'cat':'Melee weapon'}].
    Returns None unless there are ≥2 well-formed 'N [category]' segments."""
    segs = []
    for part in re.split(r'\s+and\s+', spec, flags=re.I):
        mm = re.match(r'(\d+)\s+(.+)', part.strip())
        if not mm:
            return None
        segs.append({'n': int(mm.group(1)), 'cat': mm.group(2).strip()})
    return segs if len(segs) >= 2 else None


def _seg_predicate(cat_phrase):
    """A category phrase → (kind, value). 'Melee weapon'/'Melee'→('class','melee'),
    'Ranged weapon'→('class','ranged'), anything else→('keyword', word) e.g. 'Pistol'.
    Keyword is singularised so 'Pistols' matches the singular 'Pistol' weapon keyword."""
    c = re.sub(r'\s+weapons?$', '', cat_phrase.strip().lower()).strip()
    if c == 'melee':
        return ('class', 'melee')
    if c == 'ranged':
        return ('class', 'ranged')
    return ('keyword', re.sub(r's$', '', c))


def _opt_in_category(o, kind, val, cat):
    """True if a resolved option's weapon matches a category (weapon keyword or class)."""
    ref = o.get('ref') or ''
    slug = ref.split(':', 1)[1] if ':' in ref else slugify(o.get('name', ''))
    entry = None
    for cand in (slug, slug.rstrip('s'), slug + 's'):
        if cand in cat.weapons:
            entry = cat.weapons[cand]
            break
    if not entry:
        return False
    if kind == 'class':
        return (entry.get('section') or '').startswith(val)
    return val in (entry.get('keywords') or [])


def classify_predicate(rest, scope):
    """rest begins with 'can'/'must'. Return a clause dict (without options/id/prose)
    or None if it doesn't match any template."""
    t = rest.strip()
    colon = t.endswith(':')

    # replace [weapon] (or [A] and [B]) with [N] of the following:   (colon required)
    #   N == 1 → the classic single swap, pick{0,1}.
    #   N  > 1 → a model that replaces takes exactly N *distinct* items from the list,
    #            giving up the named weapon (e.g. Lychguard Warscythe → 2 of Hyperphase
    #            Sword / Voidblade / Particle Caster / Dispersion Shield). Optional
    #            (min 0) like every "can replace"; the engine subtracts the replaced
    #            weapon once per replacing model (selections ÷ pick.max), not per pick.
    #   `parse_replaces` handles both a single weapon and "A and B".
    m = re.match(r'(?:can|must)\s+replace (?:its|their)\s+(.+?)\s+with (\d+) of the following', t, re.I)
    if m and colon:
        n = int(m.group(2))
        pick = {'min': 0, 'max': n}
        if n > 1:
            pick['distinct'] = True
        return {'op': 'replace', 'scope': scope, 'replaces': parse_replaces(m.group(1)),
                'pick': pick, '_list': True}

    # replace [weapon] with [N1] [cat1] and [N2] [cat2] [and …] from the following [list]:
    #   compound category-filtered replacement (e.g. "with 1 Pistol and 1 Melee weapon
    #   from the following list:"). Marked _compound; parse_section decomposes it at flush
    #   into a replace (segment 0) + add clauses (rest), partitioning the shared list by
    #   each segment's weapon keyword/class. [label]/colon optional; ≥2 segments required.
    m = re.match(r'(?:can|must)\s+replace (?:its|their)\s+(.+?)\s+with\s+(.+?)\s+from the following(?:\s+list)?\s*:?\s*$', t, re.I)
    if m:
        segs = _parse_compound_segments(m.group(2))
        if segs:
            return {'op': 'replace', 'scope': scope, 'replaces': parse_replaces(m.group(1)),
                    'pick': {'min': 0, 'max': 1}, '_list': True, '_compound': segs}

    # replace ... with <specific>.  (direct, no list)
    m = re.match(r'(?:can|must)\s+replace (?:its|their)\s+(.+?)\s+with\s+(.+?)\.?$', t, re.I)
    if m and not colon and 'of the following' not in t.lower():
        return {'op': 'replace', 'scope': scope, 'replaces': parse_replaces(m.group(1)),
                'pick': {'min': 0, 'max': 1}, '_inline': m.group(2)}

    # must be equipped with N of the following, but can only select 1 of each option:
    m = re.match(r'must be equipped with (\d+) of the following,?\s*but can only select 1 of each', t, re.I)
    if m:
        n = int(m.group(1))
        return {'op': 'choose', 'scope': scope, 'replaces': None,
                'pick': {'min': n, 'max': n, 'distinct': True}, '_list': True}

    # (can|must) (be equipped with|select) [up to|any] N of the following [label]:
    #   can  → optional, pick up to N      must → compulsory, pick exactly N    (N may be 1)
    # "up to N" and "any N" both accepted; "The unit …" yields who:'unit' (all models, ×N).
    # The [label] AND the trailing colon are both OPTIONAL — "…of the following" already
    # names the list, so "1 of the following", "up to N of the following" (no label/colon)
    # are valid; the label (when present) just pins the target slot.
    m = re.match(r'(?:can|must)\s+(?:be equipped with|select)\s+(?:up to\s+|any\s+)?(\d+) of the following(?:\s+(.+?))?:?\s*$', t, re.I)
    if m:
        is_must = bool(re.match(r'must', t, re.I))
        n = int(m.group(1))
        slot = label_to_slot(m.group(2)) if m.group(2) else None
        cl = {'op': 'choose' if is_must else 'add', 'scope': scope, 'replaces': None,
              'pick': {'min': n if is_must else 0, 'max': n}, '_list': True}
        if slot:
            cl['slot'] = slot
        return cl

    # can be equipped with any of the following [label]:   ([label]/colon optional)
    m = re.match(r'(?:can|must)\s+be equipped with any of the following(?:\s+(.+?))?:?\s*$', t, re.I)
    if m:
        slot = label_to_slot(m.group(1)) if m.group(1) else None
        cl = {'op': 'add', 'scope': scope, 'replaces': None,
              'pick': {'min': 0, 'max': None}, '_list': True}
        if slot:
            cl['slot'] = slot
        return cl

    # bare "(can|must) be equipped with[ the following]:" — list follows (e.g. alt loadout)
    m = re.match(r'(?:can|must)\s+be equipped with(?: the following)?:$', t, re.I)
    if m:
        is_must = bool(re.match(r'must', t, re.I))
        return {'op': 'choose' if is_must else 'add', 'scope': scope, 'replaces': None,
                'pick': {'min': 1 if is_must else 0, 'max': 1}, '_list': True}

    # can be equipped with up to Nx <item>.  (single inline item — NOT a list)
    m = re.match(r'can be equipped with up to (\d+)\s*x?\s+(.+?)\.?$', t, re.I)
    if m and not colon and 'of the following' not in t.lower():
        return {'op': 'add', 'scope': scope, 'replaces': None,
                'pick': {'min': 0, 'max': int(m.group(1))}, '_inline': m.group(2)}

    # (can|must) be equipped with <item>.  /  is equipped with <item(s)>.
    m = re.match(r'(?:can|must)\s+be equipped with\s+(.+?)\.?$', t, re.I)
    if m and not colon and 'of the following' not in t.lower():
        op = 'fixed' if re.match(r'must', t, re.I) else 'add'
        return {'op': op, 'scope': scope, 'replaces': None,
                'pick': {'min': 1, 'max': 1} if op == 'fixed' else {'min': 0, 'max': 1},
                '_inline': m.group(1)}

    return None


# ── Whole-paragraph classifier ─────────────────────────────────────────────────
def classify_paragraph(text):
    """Return one of:
       ('note', text)                         -- footnote line (starts with *)
       ('modifier', meta)                     -- 'any weapon ... upgraded ...'
       ('modifier-each', meta)                -- 'Each <weapon> ... upgraded to include 1 of the following:'
       ('clause', clause_dict)                -- a recognised option clause
       ('fixed-list-intro', {modelType})     -- '<subject> is equipped with the following:' (items follow)
       ('fixed-inline', {text, modelType})   -- '<subject> is equipped with <weapon(s)>' (inline)
       None                                   -- not an intro; treated as list item / fixed item
    Conditionals/alternatives are folded into the clause dict.
    """
    t = clean(text)
    if not t:
        return None

    if t.startswith('*'):
        return ('note', t.lstrip('* ').strip())

    # informational note (no selection): "Additionally, this model knows ..."
    if re.match(r'additionally[,\s]', t, re.I):
        return ('note', t)

    # normalise "can then be equipped" (conditional follow-on) → "can be equipped"
    t = re.sub(r'\bcan then be equipped\b', 'can be equipped', t, flags=re.I)

    # Mount host block intro: "<subject> must be mounted in [N] of the following …:".
    # The host list is harvested separately (parse_mount → forceOrg.mount); flag the
    # intro so parse_section swallows it plus the host bullet lines and the trailing
    # "After selecting …" paragraph instead of erroring on them as stray wargear.
    if re.search(r'\bmust be mounted in\b.*\bof the following\b', t, re.I):
        return ('mount-intro', None)

    # fixed standard wargear: "<subject> is equipped with ..."
    #   Generic subjects (every/each model, this model, the unit) equip the whole unit;
    #   a named "Every/Each <model-or-role>" subject scopes the wargear to that model type.
    #   An unrecognised subject (mt is False) falls through to the branches below.
    m = re.match(r'(.+?)\s+is equipped with\s*(.*)$', t, re.I)
    if m and 'of the following' not in t.lower():
        mt = _fixed_subject_modeltype(m.group(1).strip())
        if mt is not False:
            rest = m.group(2).strip()
            if rest == '' or rest.rstrip().endswith(':'):
                return ('fixed-list-intro', {'modelType': mt})
            return ('fixed-inline', {'text': rest.rstrip('.'), 'modelType': mt})

    # psychic attacks as compulsory wargear: "[Additionally,] <subject> know(s) the following
    # Psychic Attacks[: <inline>]". The listed attacks are gained like fixed standard wargear —
    # a colon with the list on following lines (fixed-list-intro) or inline after the colon.
    m = re.match(r'(?:additionally,?\s+)?(.+?)\s+knows?\s+the following psychic attacks?\s*:?\s*(.*)$', t, re.I)
    if m:
        mt = _fixed_subject_modeltype(m.group(1).strip())
        if mt is not False:
            rest = strip_footnote(m.group(2)).strip().rstrip('.')
            if rest == '':
                return ('fixed-list-intro', {'modelType': mt})
            return ('fixed-inline', {'text': rest, 'modelType': mt})

    # modifier flag: "Any/Every/Each [adjective] weapon … [(excluding X weapons)] can be
    # upgraded to/as a <Modifier>." Covers both "Any weapon this model is equipped with …"
    # and "Any eligible weapon equipped by any model in the unit …". The exclusion keyword
    # is extracted separately so the middle phrasing can vary freely.
    m = re.match(r'(?:any|every|each)\s+(?:[\w-]+\s+)?weapon\b.*?\bcan be upgraded\s+(?:to|as)\s+(?:an? )?(.+?)\.?\s*$', t, re.I)
    if m:
        ex = re.search(r'excluding\s+(.+?)\s+weapons?', t, re.I)
        return ('modifier', {'modifier': strip_footnote(m.group(1)).strip(),
                             'excludeKeyword': (ex.group(1).strip() if ex else None)})

    # per-weapon upgrade choice: "Each <weapon> equipped by this model can be upgraded to include 1 of the following:"
    m = re.match(r'each\s+(.+?)\s+equipped by this model can be upgraded to include 1 of the following', t, re.I)
    if m:
        return ('modifier-each', {'weapon': strip_footnote(m.group(1)).strip()})

    requires = None
    alt = None

    # alternative wrappers
    ma = re.match(r'instead of [^,]+,\s*(.+)$', t, re.I)
    if ma:
        alt = 'prev'
        body = ma.group(1).strip()
        # "any model can instead be equipped with:" -> normalise "instead "
        body = re.sub(r'\bcan instead be equipped\b', 'can be equipped', body, flags=re.I)
        t = body
    elif re.match(r'alternatively,\s+', t, re.I):
        alt = 'prev'
        t = re.sub(r'^alternatively,\s+', '', t, flags=re.I)

    # conditional: "If X is equipped with <armour>, <rest>"
    mc = re.match(r'if (?:this model|the unit|an? .+?)\s+is equipped with\s+([\w ]+?armour),\s*(.+)$', t, re.I)
    if mc:
        requires = {'armour': re.sub(r'\s*armour$', '', mc.group(1), flags=re.I).strip()}
        t = mc.group(2).strip()
    else:
        # "If [subject]'s [only|Primary] Ranged weapon(s) has/have the [kw] keyword, …"
        # Qualifier (only/Primary) is optional; has/have both accepted. The engine's
        # weaponKeyword check inspects the primary-ranged slot, so "Primary Ranged
        # Weapon has …" is exactly what it enforces.
        mc = re.match(r"if (?:an? )?[\w' ]+?'s (?:(?:only|primary) )?ranged weapon\(?s?\)? (?:have|has) the (\w+) keyword,\s*(.+)$", t, re.I)
        if mc:
            requires = {'weaponKeyword': mc.group(1).strip()}
            t = mc.group(2).strip()

    # conditional: "<subject> equipped with a X or Y can be equipped with Z."
    mw = re.match(r'(every model(?: in the unit)?|any model|this model)\s+equipped with (?:a |an )?(.+?)\s+can be equipped with\s+(.+?)\.?$', t, re.I)
    if mw and ' or ' in mw.group(2).lower() or (mw and 'of the following' not in t.lower() and ' equipped with ' in t.lower()[:40]):
        weapons = [strip_footnote(p).strip() for p in re.split(r'\s+or\s+', mw.group(2), flags=re.I)]
        scope = {'who': 'each', 'requires': {'weaponIn': weapons}}
        return ('clause', {'op': 'add', 'scope': scope, 'replaces': None,
                           'pick': {'min': 0, 'max': 1}, '_inline': mw.group(3)})

    scope, rest = parse_subject(t)
    # bare "1 of the following <label>:" (implied subject = each model, compulsory)
    if scope is None:
        mb = re.match(r'1 of the following(?:\s+(.+?))?:', t, re.I)
        if mb:
            slot = label_to_slot(mb.group(1)) if mb.group(1) else None
            cl = {'op': 'choose', 'scope': {'who': 'each'}, 'replaces': None,
                  'pick': {'min': 1, 'max': 1}, '_list': True}
            if slot:
                cl['slot'] = slot
            if requires:
                cl['scope']['requires'] = requires
            if alt:
                cl['_alt'] = alt
            return ('clause', cl)
        return None

    cl = classify_predicate(rest, scope)
    if cl is None:
        return None
    # A unit-level REPLACE (e.g. shared armour: "The unit can replace its …") is a
    # uniform swap, not a finite pool — keep it who:unit, not who:unitPool.
    if cl.get('op') == 'replace' and (cl.get('scope') or {}).get('who') == 'unitPool':
        cl['scope']['who'] = 'unit'
    if requires:
        cl['scope']['requires'] = requires
    if alt:
        cl['_alt'] = alt
    return ('clause', cl)


# ── Section parser ──────────────────────────────────────────────────────────────
def _catalog_categories(slug):
    """Faction upgrade-catalog categories, keyed by lower-cased Category name. A unit H6
    whose heading matches one of these is a catalog-backed key characteristic."""
    path = os.path.join(CATALOG_DIR, f"{slug}.json")
    if not os.path.exists(path):
        return {}
    data = json.load(open(path, encoding='utf-8'))
    return {str(c.get('category', '')).strip().lower(): c for c in data.get('catalogs', [])}


def _reconcile_allowance(unit, cap, comp, unit_name, slug):
    """Cross-check a catalog section's prose-stated cap against the Upgrade Allowance
    workbook column. The column wins where present (it is the only place `champion`
    scope can be expressed); the prose supplies the allowance where the column is blank."""
    existing = unit.get('upgradeAllowance') or []
    unit_scope = [a for a in existing if a.get('scope') == 'unit']
    if unit_scope:
        if unit_scope[0].get('count') != cap:
            WARNINGS.append(
                f"[{slug}/{unit_name}] Upgrade Allowance column says "
                f"{unit_scope[0].get('count')} unit but the prose says {cap} — "
                f"column wins; fix whichever is wrong")
        return
    mts = (comp or {}).get('modelTypes') or []
    if not mts:
        return
    unit.setdefault('upgradeAllowance', []).append(
        {'scope': 'unit', 'count': cap, 'distinct': True, 'modelType': mts[0]['name']})


def _is_item_line(p):
    """True when a paragraph is an option/item line rather than narrative prose — i.e.
    the author gave it the 'Wargear' or 'Weapon' paragraph style (the same styling that
    makes it a hoverable ref span on the faction page), or every styled run in it is one
    of those character styles."""
    sty = (p.style.name if p.style else '') or ''
    if sty.strip().lower() in ('wargear', 'weapon'):
        return True
    runs = [r for r in p.runs if r.text.strip()]
    if not runs:
        return False
    return all((get_run_style_name(r) or '').strip().lower() in ('wargear', 'weapon')
               for r in runs)


def _keychar_select(paras):
    """Find the "must/can select [up to] N of the following" intro among a section's
    paragraphs. Returns ({'min','max'}, intro_text) or (None, None)."""
    for p in paras:
        m = KEYCHAR_INTRO_RE.search(clean(p.text))
        if not m:
            continue
        n = int(m.group('n'))
        compulsory = m.group('mode').lower() == 'must'
        return {'min': n if compulsory else 0, 'max': n}, clean(p.text)
    return None, None


def parse_key_characteristic(label, items, cat, catalog_cats, ctx_unit, faction_slug, errors):
    """Build a `keyCharacteristic` section from one unrecognised H6 block.

    `items` is the ordered [(kind, text, paragraph)] recording of the block, where kind
    is 'p' for a body paragraph and 'h7'/'h8' for a structural heading.

    Two sources, distinguished by whether the heading names a faction upgrade catalog:
      - catalog : options come from src/data/upgrade-catalogs/{slug}.json (shared pool,
                  priced per pick). The intro sentence is optional — Chaos states its
                  allowance in free prose, and the workbook column stays authoritative.
      - inline  : options are the H7 blocks, each with `Wargear:` / `Abilities:` /
                  `Leader:` H8 sub-blocks. The intro sentence is required (it is the
                  only statement of cardinality).
    Returns (section_dict, allowance_max) — allowance_max is the prose-stated cap for a
    catalog section, for cross-checking the Upgrade Allowance column.
    """
    sec_id = slugify(label)
    catalog = catalog_cats.get(label.strip().lower())
    lead = [p for kind, _t, p in items if kind == 'p']
    # body paragraphs before the first H7 are the section's own intro prose
    intro_paras, seen_h7 = [], False
    for kind, _t, p in items:
        if kind == 'h7':
            seen_h7 = True
        elif kind == 'p' and not seen_h7:
            intro_paras.append(p)
    select, _intro = _keychar_select(intro_paras or lead)

    section = {
        'key': SEC_KEYCHAR,
        'id': sec_id,
        'label': label,
        'prose': _render_prose_only(intro_paras),
        # null on a catalog section whose prose states its allowance free-form (Chaos):
        # the Upgrade Allowance column is then the only cap, per the plan doc §10 Q3.
        'select': select,
        'scope': 'unit',           # per-model scope reserved; see the plan doc §10 Q2
        'source': 'catalog' if catalog else 'inline',
        'catalogId': catalog['catalogId'] if catalog else None,
        'profiles': [],
    }
    ctx = f"[{faction_slug}/{ctx_unit}/{label}]"

    # ── Catalog-backed: validate any listed option names against the catalog ──────
    if catalog:
        by_name = {str(it.get('name', '')).strip().lower(): it for it in catalog.get('items', [])}
        listed, prose_paras = [], []
        for p in lead:
            t = strip_footnote(clean(p.text)).rstrip('.').strip()
            if not t:
                continue
            # The author marks an option line with the 'Wargear'/'Weapon' paragraph style
            # (that is what makes it a ref span on the faction page). Anything else is
            # narrative. So a styled line MUST resolve — no guessing either way.
            if _is_item_line(p):
                it = by_name.get(t.lower())
                if it is None:
                    errors.append(f"{ctx} listed option {t!r} is not an item in catalog "
                                  f"{catalog['category']!r}")
                else:
                    listed.append(it['id'])
            else:
                prose_paras.append(p)
        # An explicit list restricts the unit to that subset; no list = the whole catalog.
        if listed:
            section['itemIds'] = listed
        section['prose'] = _render_prose_only(prose_paras)
        return section, (select or {}).get('max')

    # ── Inline: one profile per H7, its clauses parsed with Standard-Wargear rules ──
    if select is None:
        errors.append(f"{ctx} key characteristic has no "
                      f"'<subject> must/can select N of the following …' sentence")
        return None, None

    profiles, cur, sub = [], None, 'wargear'
    for kind, text, p in items:
        if kind == 'h7':
            cur = {'id': slugify(text), 'name': text, 'points': None, 'clauses': [],
                   'abilities': '', 'leader': '', '_wargear': [], '_abilities': [], '_leader': []}
            profiles.append(cur)
            sub = 'wargear'      # items straight under an H7 with no H8 are wargear
            continue
        if kind == 'h8':
            lbl = clean(text).rstrip(':').strip().lower()
            sub = KEYCHAR_H8.get(lbl)
            if sub is None:
                errors.append(f"{ctx} unrecognised sub-heading {text!r} "
                              f"(expected Wargear / Abilities / Leader)")
                sub = 'wargear'
            continue
        if cur is None:
            continue             # intro prose, already captured
        cur['_' + sub].append(p)

    if not profiles:
        errors.append(f"{ctx} key characteristic declares a selection but has no options")
        return None, None

    for pr in profiles:
        if pr['_wargear']:
            cls, _prose, _notes = parse_section(
                SEC_STANDARD, pr['_wargear'], cat, ctx_unit, faction_slug, errors,
                id_prefix=f"{sec_id}-{pr['id']}")
            pr['clauses'] = cls
        pr['abilities'] = _render_prose_only(pr['_abilities'])
        pr['leader'] = _render_prose_only(pr['_leader'])
        for k in ('_wargear', '_abilities', '_leader'):
            pr.pop(k)
    section['profiles'] = profiles
    return section, None


def parse_section(section_key, paras, cat, ctx_unit, faction_slug, errors, id_prefix=None):
    """Parse a list of (text) paragraphs for one H6 section.
    Returns (clauses, prose_html, notes).

    `section_key` selects the parsing *semantics* (only SEC_STANDARD treats a bare item
    line as compulsory wargear); `id_prefix` overrides the clause-id namespace. A key
    characteristic's `Wargear:` block is parsed with Standard-Wargear semantics under a
    per-profile prefix, so two profiles' clauses can never collide on id."""
    clauses, notes = [], []
    prose_parts = []
    open_clause = None
    swallowing = False   # inside a mount host block (intro → hosts → "After selecting …")
    gid = [0]
    last_clause_id = [None]

    def new_id(op):
        gid[0] += 1
        return f"{id_prefix or section_key}-{op}-{gid[0]}"   # unique within the unit

    def _split_compound(cl):
        """Decompose a compound replace ("with 1 Pistol and 1 Melee weapon from the
        following:") into a replace (segment 0) + add clauses (rest), each holding the
        collected list items that match its category — reusing standard clause machinery."""
        ctx = f"[{faction_slug}/{ctx_unit}/{section_key}]"
        opts = cl.get('options', [])
        out, matched_any = [], set()
        cg = new_id('cmp')                        # shared group id → rendered as one merged list
        base_scope = cl.get('scope') or {}
        for seg in cl['_compound']:
            kind, val = _seg_predicate(seg['cat'])
            matched = [o for o in opts if _opt_in_category(o, kind, val, cat)]
            for o in matched:
                matched_any.add(o.get('ref'))
            if not matched:
                errors.append(f"{ctx} compound category '{seg['n']} {seg['cat']}' matched no items in the list")
                continue
            is_first = (len(out) == 0)             # the first matched segment carries the replace + prose
            # who:count caps EACH category at its own segment count (1 Pistol, 1 Melee), independent
            # of squad size — you pick 1 of one category and 1 of the other, not 2 of one.
            sub_scope = {'who': 'count', 'count': seg['n']}
            if base_scope.get('modelType'):
                sub_scope['modelType'] = base_scope['modelType']
            if base_scope.get('requires'):
                sub_scope['requires'] = base_scope['requires']
            out.append({
                'id': new_id('replace' if is_first else 'add'),
                'op': 'replace' if is_first else 'add',
                'prose': cl.get('prose', '') if is_first else '',   # single prose for the whole group
                'scope': sub_scope,
                'replaces': cl['replaces'] if is_first else None,
                'pick': {'min': 0, 'max': seg['n']},
                'compoundGroup': cg,
                'options': matched,
            })
        orphan = [o.get('name') for o in opts if o.get('ref') not in matched_any]
        if orphan:
            WARNINGS.append(f"{ctx}: compound list item(s) {orphan} match none of the categories "
                            f"{[s['cat'] for s in cl['_compound']]}")
        return out

    def flush():
        nonlocal open_clause
        if open_clause is not None:
            if open_clause.get('_compound'):
                clauses.extend(_split_compound(open_clause))
            elif open_clause.get('options') or open_clause.get('_allow_empty'):
                clauses.append(_finalize(open_clause))
            open_clause = None

    def _finalize(cl):
        for k in ('_list', '_inline', '_alt', '_allow_empty'):
            cl.pop(k, None)
        return cl

    for para in paras:
        text = clean(para.text)
        if not text:
            continue

        result = classify_paragraph(text)

        # ── Mount host block: swallow the host bullet lines + the "After selecting …"
        #    trailer so they never error as stray Standard Wargear. Hosts are captured
        #    by parse_mount and surfaced as forceOrg.mount. ────────────────────────
        if swallowing:
            if re.match(r'after selecting\b', text, re.I):
                prose_parts.append(_plain_prose(text))
                swallowing = False
                continue
            if result is None or result[0] == 'note':
                prose_parts.append(_plain_prose(text))   # host bullet / stray line
                continue
            swallowing = False   # a real clause/intro ends a trailer-less block; fall through

        # ── list item / fixed item (result is None) ──────────────────────────
        if result is None:
            if open_clause is not None:
                opt = resolve_option(text, cat,
                                     f"[{faction_slug}/{ctx_unit}/{section_key}]", errors)
                if opt is not None:
                    open_clause.setdefault('options', []).append(opt)
                    prose_parts.append(_prose_option(opt, text))
                continue
            # No open group:
            if section_key == SEC_STANDARD:
                # a fixed standard-wargear item (every model gets it)
                opt = resolve_option(text, cat,
                                     f"[{faction_slug}/{ctx_unit}/{section_key}]", errors)
                if opt is not None:
                    clauses.append({'id': new_id('fixed'), 'op': 'fixed',
                                    'prose': _plain_prose(text),
                                    'scope': {'who': 'each'}, 'replaces': None,
                                    'pick': {'min': 1, 'max': 1}, 'options': [opt]})
                    prose_parts.append(_prose_option(opt, text))
                continue
            # In options/armour with no open group → unrecognised sentence
            errors.append(f"[{faction_slug}/{ctx_unit}/{section_key}] "
                          f"unrecognised sentence: {text!r}")
            prose_parts.append(_plain_prose(text))
            continue

        kind = result[0]

        if kind == 'mount-intro':
            flush()
            prose_parts.append(_plain_prose(text))
            swallowing = True     # consume the following host lines + trailer
            continue

        if kind == 'note':
            notes.append(result[1])
            prose_parts.append(f'<p class="lb-footnote">{_esc(result[1])}</p>')
            continue

        if kind == 'modifier':
            flush()
            meta = result[1]
            mk, ment = cat.lookup(meta['modifier'])
            # Upgrade-modifier names may carry a trailing 'Weapon' the wargear item omits
            # (clause 'upgraded to an Accursed Weapon' → faction-wargear item 'Accursed').
            # Full name is tried first, so exact items like 'Relic Weapon' are unaffected.
            if ment is None and re.search(r'\s+weapon$', meta['modifier'], re.I):
                mk, ment = cat.lookup(re.sub(r'\s+weapon$', '', meta['modifier'], flags=re.I))
            cl = {'id': new_id('modifier'), 'op': 'modifier',
                  'prose': _plain_prose(text),
                  'modifier': meta['modifier'],
                  'modifierRef': (f"{mk}:{slugify(ment['name'])}" if ment else None),
                  'pointsPerWeapon': (ment['points'] if ment else None),
                  'scope': {'who': 'each',
                            'requires': ({'excludeKeyword': meta['excludeKeyword']}
                                         if meta['excludeKeyword'] else None)}}
            if ment is None:
                errors.append(f"[{faction_slug}/{ctx_unit}/{section_key}] "
                              f"unresolved modifier '{meta['modifier']}'")
            clauses.append(cl)
            prose_parts.append(cl['prose'])
            continue

        if kind == 'modifier-each':
            flush()
            meta = result[1]
            open_clause = {'id': new_id('modifier-each'), 'op': 'modifier',
                           'prose': _plain_prose(text),
                           'appliesTo': {'weapon': meta['weapon']},
                           'scope': {'who': 'each'},
                           'pick': {'min': 0, 'max': 1}, 'options': []}
            prose_parts.append(open_clause['prose'])
            continue

        if kind == 'fixed-list-intro':
            flush()
            scope = {'who': 'each'}
            mt = (result[1] or {}).get('modelType')
            if mt:
                scope['modelType'] = mt     # scoped to a named model/role (e.g. 'Cultist')
            open_clause = {'id': new_id('fixed'), 'op': 'fixed',
                           'prose': _plain_prose(text), 'scope': scope,
                           'replaces': None, 'pick': {'min': 1, 'max': 1}, 'options': []}
            prose_parts.append(open_clause['prose'])
            continue

        if kind == 'fixed-inline':
            flush()
            meta = result[1]
            mt = meta.get('modelType')
            prose_parts.append(_plain_prose(text))
            for part in re.split(r'\s+and\s+', meta['text'], flags=re.I):
                opt = resolve_option(part, cat,
                                     f"[{faction_slug}/{ctx_unit}/{section_key}]", errors)
                if opt is not None:
                    scope = {'who': 'each'}
                    if mt:
                        scope['modelType'] = mt
                    clauses.append({'id': new_id('fixed'), 'op': 'fixed', 'prose': '',
                                    'scope': scope, 'replaces': None,
                                    'pick': {'min': 1, 'max': 1}, 'options': [opt]})
            continue

        # kind == 'clause'
        flush()
        cl = result[1]
        cl['id'] = new_id(cl['op'])
        cl['prose'] = _plain_prose(text)
        if cl.pop('_alt', None):
            cl['altGroup'] = last_clause_id[0]
        prose_parts.append(cl['prose'])

        if cl.pop('_list', None):
            cl.setdefault('options', [])
            open_clause = cl
            last_clause_id[0] = cl['id']
        else:
            inline = cl.pop('_inline', None)
            if inline is not None:
                opt = resolve_option(inline, cat,
                                     f"[{faction_slug}/{ctx_unit}/{section_key}]", errors)
                cl['options'] = [opt] if opt else []
            clauses.append(_finalize(cl))
            last_clause_id[0] = cl['id']

    flush()
    return clauses, '\n'.join(prose_parts), notes


# ── Prose rendering ─────────────────────────────────────────────────────────────
def _esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def _plain_prose(text):
    return f'<p>{_esc(clean(text))}</p>'


def _prose_option(opt, raw):
    """Render a resolved option list-item as prose with a ref span + tooltip hook."""
    cls = 'weapon-ref' if opt['kind'] == 'weapon' else 'wargear-ref'
    attr = 'data-weapon' if opt['kind'] == 'weapon' else 'data-wargear'
    slug = opt['ref'].split(':', 1)[1]
    prefix = ''
    if opt.get('qty', 1) != 1:
        prefix += f"{opt['qty']}x "
    if 'twin-linked' in opt.get('modifiers', []):
        prefix += 'Twin-linked '
    label = _esc(opt['name'])
    span = f'<span class="{cls}" {attr}="{slug}">{label}</span>'
    extra = ''
    for a in opt.get('and', []):
        acls = 'weapon-ref' if a['kind'] == 'weapon' else 'wargear-ref'
        aattr = 'data-weapon' if a['kind'] == 'weapon' else 'data-wargear'
        aslug = a['ref'].split(':', 1)[1]
        extra += f' and <span class="{acls}" {aattr}="{aslug}">{_esc(a["name"])}</span>'
    return f'<p class="lb-opt">{_esc(prefix)}{span}{extra}</p>'


# ── Force Organization parsing ──────────────────────────────────────────────────
def parse_force_org(paras):
    text = ' '.join(clean(p.text) for p in paras if clean(p.text))
    if not text:
        return None
    # "1 ... in games of N points or less, and ... up to M ... over N"
    m = re.search(r'(\d+)\s+\w[\w ]*?\s+in games of ([\d,]+) points or less,?\s+and can include up to (\d+)', text, re.I)
    if m:
        lo = int(m.group(2).replace(',', ''))
        return {'tiers': [{'maxPoints': lo, 'count': int(m.group(1))},
                          {'minPoints': lo + 1, 'count': int(m.group(3))}],
                'raw': text}
    # "1 X for every Senior Officer, Junior Officer or Epic Hero"
    # The capture is sentence-bounded ([^.]) on purpose: it used to be `.+?`, which ran
    # straight past the full stop in "…for every 2,000 points. If you have 1 or more X
    # units in your army", producing reference garbage that compiled to a limit of 0 and
    # blocked a legal list. Prefer no rule over a wrong one — the Force Org Constraints
    # column is the authoritative source now, and this is only the fallback.
    m = re.search(r'1\s+[\w ]+?\s+for every\s+([^.]+?)\s+in your army', text, re.I)
    if m and not re.search(r'\d', m.group(1)):
        parts = re.split(r',\s*|\s+or\s+', m.group(1))
        return {'onePerEach': [p.strip() for p in parts if p.strip()], 'raw': text}
    return {'raw': text}


def _resolve_host_unit(name, unit_index):
    """Map a mount host name (which may be a model variant, e.g. 'Scout Sentinel')
    to its owning unit name (e.g. 'Sentinels'). Falls back to the name as-is."""
    if name in unit_index:
        return name
    for un, u in unit_index.items():
        for m in (u.get('models') or []):
            if m.get('modelName') == name:
                return un
    return name


def parse_mount(std_paras, unit_index):
    """Squadron Commander one-off: from the Standard Wargear 'must be mounted in 1 of
    the following …:' paragraph, collect the host allowlist (the bullet lines that
    follow, up to the 'After selecting …' paragraph), resolved to owning unit names."""
    texts = [clean(p.text) for p in std_paras]
    trig = None
    for i, t in enumerate(texts):
        if t and re.search(r'must be mounted in\b.*\bof the following', t, re.I):
            trig = i
            break
    if trig is None:
        return None
    hosts = []
    for t in texts[trig + 1:]:
        if not t:
            continue
        if re.match(r'after selecting\b', t, re.I):
            break
        nm = re.sub(r'^[\-•\s]+', '', t).strip().rstrip('.')
        if not nm:
            continue
        if len(nm.split()) > 7:   # host names are short; longer → trailing prose ended the list
            break
        ru = _resolve_host_unit(nm, unit_index)
        if ru not in hosts:
            hosts.append(ru)
    return hosts or None


def parse_requires_other(force_paras):
    """Force-Organization prerequisite: 'can only include … if it includes at least
    N other <Keyword> unit'. Returns {'keyword', 'min'} or None."""
    text = ' '.join(clean(p.text) for p in force_paras)
    m = re.search(r'at least (\d+) other ([A-Za-z][\w ]*?) units?\b', text, re.I)
    if m:
        return {'keyword': m.group(2).strip(), 'min': int(m.group(1))}
    return None


# ── Composition (from units JSON) ──────────────────────────────────────────────
def build_composition(unit, comp_paras):
    comp_text = ' '.join(clean(p.text) for p in comp_paras if clean(p.text))
    stats = unit.get('stats') or {}
    models = unit.get('models')
    # tiers: "A, or B" in composition prose
    if comp_text and re.search(r',\s*or\b', comp_text, re.I):
        tiers = [seg.strip() for seg in re.split(r',\s*or\s+|\bor\b', comp_text) if seg.strip()]
        return {'mode': 'tiers', 'tiersRaw': tiers, 'prose': comp_text}, comp_text
    if models:
        # multi-statline: each model type carries its own keywords (may differ per type)
        mt = []
        for m in models:
            d = {'name': m.get('modelName'), 'stats': m.get('stats'),
                 'basePoints': (m.get('stats') or {}).get('basePoints'),
                 'keywords': m.get('keywords') or []}
            if m.get('countLimit'):        # ratio-limited count (Squad Size Constraints)
                d['countLimit'] = m['countLimit']
            if m.get('transform'):         # coupled transform, e.g. +1 HWT = -2 base
                d['transform'] = m['transform']
            mt.append(d)
        return {'mode': 'multi', 'modelTypes': mt, 'prose': comp_text}, comp_text
    sizes = (stats.get('squadSizes') or '1')
    mm = re.search(r'(\d+)\s*(?:to|-)\s*(\d+)', str(sizes))
    if mm:
        comp = {'mode': 'range', 'range': {'min': int(mm.group(1)), 'max': int(mm.group(2))}}
    else:
        n = int(re.sub(r'\D', '', str(sizes)) or '1')
        comp = {'mode': 'single' if n == 1 else 'range',
                'range': {'min': n, 'max': n}}
    comp['modelTypes'] = [{'name': unit.get('name'), 'stats': stats,
                           'basePoints': stats.get('basePoints'),
                           'keywords': unit.get('keywords') or []}]
    comp['prose'] = comp_text
    return comp, comp_text


# ── Main conversion ─────────────────────────────────────────────────────────────
def convert(docx_path, faction_filter, errors):
    doc = Document(docx_path)
    paras = doc.paragraphs

    # locate faction H2 spans
    def is_faction_h2(text, lvl):
        return (lvl == 2 and text.lower().strip() not in
                (ALLIANCE_HEADERS | H3_UNIT_PROFILES | H3_WARGEAR_UP | H3_OTHER))

    spans = [(clean(p.text), i) for i, p in enumerate(paras)
             if get_heading_level(p) and is_faction_h2(clean(p.text), get_heading_level(p))]
    ranges = [(n, s, spans[k + 1][1] if k + 1 < len(spans) else len(paras))
              for k, (n, s) in enumerate(spans)]

    written = 0
    for fac_name, fstart, fend in ranges:
        slug = slugify(fac_name)
        if faction_filter and slug != faction_filter:
            continue

        units_path = os.path.join(UNITS_DIR, f"{slug}.json")
        if not os.path.exists(units_path):
            print(f"  SKIP {slug}: no units JSON")
            continue
        units_data = json.load(open(units_path, encoding='utf-8'))
        unit_index = {u['name']: u for u in units_data.get('units', [])}
        cat = Catalog(slug)

        # walk H3 sections; only parse the Unit Profiles H3
        in_units = False
        cur_unit = None
        cur_sec = None
        buf = {}          # section_key -> [paras]
        ubuf = []         # ordered [(h6_label, [(kind, text, para)])] for unrecognised H6s
        results = {}      # unit_name -> options dict
        catalog_cats = _catalog_categories(slug)

        def close_unit():
            nonlocal cur_unit, buf, ubuf
            if not cur_unit:
                return
            unit = unit_index.get(cur_unit)
            if unit is None:
                buf = {}
                ubuf = []
                cur_unit = None
                return
            sections = []
            comp, _ = build_composition(unit, buf.get(SEC_COMP, []))
            force = parse_force_org(buf.get(SEC_FORCE, [])) if buf.get(SEC_FORCE) else None
            # Squadron Commander mounting one-off: attach the host allowlist (from the
            # Standard Wargear "must be mounted in …" paragraph) and the "at least N
            # other X unit" prerequisite as structured forceOrg the List Builder enforces.
            _mount_hosts = parse_mount(buf.get(SEC_STANDARD, []), unit_index)
            _req_other = parse_requires_other(buf.get(SEC_FORCE, []))
            if _mount_hosts or _req_other:
                if force is None:
                    force = {}
                if _req_other:
                    force['requiresOther'] = _req_other
                if _mount_hosts:
                    force['mount'] = {'hosts': _mount_hosts}
            slots = set()
            for key in (SEC_COMP, SEC_STANDARD, SEC_SPECIAL, SEC_FORCE,
                        SEC_ARMOUR, SEC_WARGEAR, SEC_LEADER):
                if key not in buf:
                    continue
                if key in INTERACTIVE_SECTIONS:
                    cls, prose, notes = parse_section(
                        key, buf[key], cat, cur_unit, slug, errors)
                    for c in cls:
                        if c.get('slot'):
                            slots.add(c['slot'])
                        if isinstance(c.get('replaces'), dict) and c['replaces'].get('slot'):
                            slots.add(c['replaces']['slot'])
                    sections.append({'key': key, 'prose': prose,
                                     'clauses': cls, 'notes': notes})
                else:
                    sections.append({'key': key,
                                     'prose': _render_prose_only(buf[key]),
                                     'clauses': []})
            # ── Unrecognised H6 blocks: key characteristics, prose, or a hard error ──
            for label, recorded in ubuf:
                if label.strip().lower() in PROSE_ONLY_H6:
                    sections.append({'key': SEC_EXTRA, 'id': slugify(label), 'label': label,
                                     'prose': _render_prose_only([p for k, _t, p in recorded
                                                                 if k == 'p']),
                                     'clauses': []})
                    continue
                has_h7 = any(k == 'h7' for k, _t, _p in recorded)
                if label.strip().lower() not in catalog_cats and not has_h7:
                    errors.append(
                        f"[{slug}/{cur_unit}] unrecognised H6 section {label!r} — it names no "
                        f"upgrade catalog, has no option (H7) blocks, and is not listed in "
                        f"PROSE_ONLY_H6. Fix the heading or add it to the allow-list.")
                    continue
                sec, prose_cap = parse_key_characteristic(
                    label, recorded, cat, catalog_cats, cur_unit, slug, errors)
                if sec is not None:
                    sections.append(sec)
                    for pr in sec.get('profiles', []):
                        for c in pr.get('clauses', []):
                            if c.get('slot'):
                                slots.add(c['slot'])
                # A catalog-backed section states its own cap in prose. The Upgrade
                # Allowance workbook column stays authoritative where present (it is the
                # only place `champion` scope can be expressed); the prose fills in where
                # the column is absent, and disagreement is warned with the column winning.
                if prose_cap:
                    _reconcile_allowance(unit, prose_cap, comp, cur_unit, slug)

            warn_banded_on_mixed_unit(cur_unit, comp, sections, cat)
            results[cur_unit] = {
                'forceOrg': force,
                'composition': comp,
                'slots': sorted(slots),
                'sections': sections,
            }
            buf = {}
            ubuf = []
            cur_unit = None

        for p in paras[fstart + 1:fend]:
            text = clean(p.text)
            lvl = get_heading_level(p)
            if lvl == 3:
                close_unit()
                in_units = text.lower() in H3_UNIT_PROFILES
                cur_sec = None
                continue
            if not in_units:
                continue
            if lvl == 4:
                close_unit()
                cur_sec = None
                continue
            if lvl == 5:
                close_unit()
                cur_unit = text
                cur_sec = None
                continue
            if lvl == 6:
                head = text.split('\t')[0].strip()
                key = H6_MAP.get(head.lower())
                if key:
                    cur_sec = key
                    buf.setdefault(key, [])
                else:
                    # Unrecognised heading: buffer it (with its H7/H8 structure) as a
                    # candidate rather than dropping it, and resolve it in close_unit().
                    ubuf.append((head, []))
                    cur_sec = ubuf[-1][1]
                continue
            if lvl in (7, 8):
                if isinstance(cur_sec, list):
                    cur_sec.append((f'h{lvl}', text, p))
                else:
                    cur_sec = None   # H7/H8 under a known section still ends it (unchanged)
                continue
            if cur_unit and cur_sec is not None:
                if isinstance(cur_sec, list):
                    cur_sec.append(('p', text, p))
                else:
                    buf[cur_sec].append(p)
        close_unit()

        # merge options into units JSON
        merged = 0
        for u in units_data.get('units', []):
            if u['name'] in results:
                u['options'] = results[u['name']]
                u['epicHero'] = any(k.lower() == 'epic hero' for k in u.get('keywords', []))
                merged += 1

        ensure_dir(UNITS_DIR)
        json.dump(units_data, open(units_path, 'w', encoding='utf-8'),
                  indent=2, ensure_ascii=False)
        # mirror canonical record to the client-fetched copy
        ensure_dir(PUBLIC_UNITS_DIR)
        json.dump(units_data, open(os.path.join(PUBLIC_UNITS_DIR, f"{slug}.json"),
                                   'w', encoding='utf-8'),
                  indent=2, ensure_ascii=False)
        print(f"  {slug}: options merged into {merged} units")
        # ── Force-org drift ───────────────────────────────────────────────────────
        # Two sources describe the same rule: the Force Organization H6 (what the
        # player reads) and the workbook's Force Org Constraints column (what the
        # List Builder enforces). Once a faction adopts the column, report where only
        # one of the pair exists rather than reconciling them — the author decides.
        if any(u.get('forceOrg') for u in units_data.get('units', [])):
            for u in units_data.get('units', []):
                prose = (results.get(u['name']) or {}).get('forceOrg')
                has_h6 = bool(prose and prose.get('raw'))
                if has_h6 and not u.get('forceOrg'):
                    print(f"    ⚠  {u['name']}: has a Force Organization H6 but no Force Org "
                          f"Constraints cell — the rule is not enforced")
                elif u.get('forceOrg') and not has_h6:
                    print(f"    ⚠  {u['name']}: has a Force Org Constraints cell "
                          f"({u['forceOrg']['raw']!r}) but no Force Organization H6 — "
                          f"the rule is enforced but undocumented")
        written += 1

    return written


# Prose-only sections (Special Abilities, Leader, …) render through the shared
# renderer in ah_converter_utils, which the wargear and detachment-trait converters
# also use for their `effectsHtml` — one definition of what authored prose becomes.
_md_inline = md_inline
_render_prose_only = render_prose_html


# ── Pipeline entry (used by run_all.py) ─────────────────────────────────────────
def run(docx_path=FACTION_INDEX_DOCX, faction_filter=None):
    """run_all-compatible wrapper: raises on any hard error so the step is
    reported as failed."""
    errors = []
    convert(docx_path, faction_filter, errors)
    if WARNINGS:
        print(f"  ({len(WARNINGS)} non-fatal warning(s))")
    if errors:
        for e in errors:
            print(f"    ! {e}")
        raise RuntimeError(f"convert_options: {len(errors)} unresolved item(s)")


# ── Entry point ─────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description='Parse per-unit options into canonical JSON')
    ap.add_argument('--faction', '-f', default=None)
    ap.add_argument('--docx', default=FACTION_INDEX_DOCX)
    args = ap.parse_args()

    print("=" * 64)
    print("  Countermarch -- convert_options (grammar parser)")
    print(f"  Source: {args.docx}")
    print("=" * 64)
    if not os.path.exists(args.docx):
        print(f"  ERROR: source not found:\n    {args.docx}")
        sys.exit(2)

    errors = []
    convert(args.docx, args.faction, errors)

    print("-" * 64)
    if WARNINGS:
        print(f"  WARNINGS: {len(WARNINGS)} (non-fatal)")
        for w in WARNINGS:
            print(f"    ~ {w}")
        print("-" * 64)
    if errors:
        print(f"  HARD ERRORS: {len(errors)} (build failed)")
        for e in errors:
            print(f"    ! {e}")
        sys.exit(1)
    print("  OK: zero unmatched sentences / unresolved refs")
    print("=" * 64)


if __name__ == '__main__':
    main()
