"""Pretty-print the parsed `options` for given AA units (spot-check)."""
import json, sys
d = json.load(open('src/data/units/adeptus-astartes.json', encoding='utf-8'))
idx = {u['name']: u for u in d['units']}
for name in (sys.argv[1:] or ['Captain']):
    u = idx.get(name)
    if not u:
        print(f"!! {name} not found"); continue
    o = u.get('options', {})
    print(f"\n########## {name}  (cat={u.get('category')}, epicHero={u.get('epicHero')}) ##########")
    print(f"  forceOrg: {json.dumps(o.get('forceOrg'))}")
    print(f"  composition: {json.dumps(o.get('composition', {}).get('mode'))} "
          f"{json.dumps(o.get('composition', {}).get('range') or o.get('composition', {}).get('tiersRaw') or '')}")
    print(f"  slots: {o.get('slots')}")
    for sec in o.get('sections', []):
        if not sec.get('clauses'):
            continue
        print(f"  ── section: {sec['key']}")
        for c in sec['clauses']:
            sc = c.get('scope', {})
            who = sc.get('who')
            extra = []
            if sc.get('modelType'): extra.append(f"type={sc['modelType']}")
            if sc.get('count'): extra.append(f"count={sc['count']}")
            if sc.get('ratio'): extra.append(f"ratio={sc['ratio']}")
            if sc.get('requires'): extra.append(f"requires={sc['requires']}")
            if c.get('replaces'): extra.append(f"replaces={c['replaces']}")
            if c.get('slot'): extra.append(f"slot={c['slot']}")
            if c.get('altGroup'): extra.append(f"altGroup={c['altGroup']}")
            if c.get('appliesTo'): extra.append(f"appliesTo={c['appliesTo']}")
            pick = c.get('pick')
            opts = c.get('options', [])
            optstr = ", ".join(
                (f"{o2.get('qty',1)}x " if o2.get('qty',1)!=1 else "")
                + ("TL " if 'twin-linked' in o2.get('modifiers',[]) else "")
                + o2['name'] + (f"[{o2['points']}]" if o2.get('points') is not None else "[?]")
                + ("+" + "+".join(a['name'] for a in o2['and']) if o2.get('and') else "")
                for o2 in opts)
            print(f"     • {c['op']:9} who={who} {' '.join(extra)} pick={pick}")
            if c.get('modifier'): print(f"         modifier={c['modifier']} pts/wpn={c.get('pointsPerWeapon')}")
            if optstr: print(f"         options: {optstr}")
