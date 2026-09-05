// src/data/faction-index.ts
//
// Decides which factions are complete enough to advertise in the site's menus:
// the homepage faction grid, the /factions index, and the sidebar nav.
//
// The bar is a faction's reference data being in place — unit profiles and
// weapon profiles (both live in data/units/<slug>.json) plus wargear upgrades
// (data/faction-wargear/<slug>.json). Detachment traits are still being written
// for most factions, so they are deliberately not part of the check.
//
// A faction that misses the bar keeps its .mdx source and its /factions/<slug>
// page — it is simply absent from the menus until its data lands, at which point
// it reappears on the next build with no edit here.

const unitFiles = import.meta.glob('./units/*.json', { eager: true });
const wargearFiles = import.meta.glob('./faction-wargear/*.json', { eager: true });

function readFactionJson(files: Record<string, unknown>, slug: string): any {
  const key = Object.keys(files).find((path) => path.endsWith(`/${slug}.json`));
  if (!key) return null;
  const mod = files[key] as any;
  return mod?.default ?? mod;
}

// The generated tables carry a header row ({ name: 'Name', … }); it is not data.
function realRows(rows: unknown): any[] {
  return Array.isArray(rows) ? rows.filter((row: any) => row?.name && row.name !== 'Name') : [];
}

export function hasFactionData(slug: string): boolean {
  const unitData = readFactionJson(unitFiles, slug);
  const wargearData = readFactionJson(wargearFiles, slug);

  return (
    realRows(unitData?.units).length > 0 &&
    realRows(unitData?.weapons).length > 0 &&
    realRows(wargearData?.wargearItems).length > 0
  );
}

// Filters a list of faction frontmatter down to the ones fit to show in menus.
export function listedFactions<T extends { slug: string }>(factions: T[]): T[] {
  return factions.filter((faction) => hasFactionData(faction.slug));
}
