// src/data/factions.ts
// Central data source for all faction information and navigation structure.
// Add new factions here — the sidebar and all faction pages draw from this file.

export interface Faction {
  id: string;           // URL slug, e.g. "adeptus-astartes"
  name: string;         // Display name
  alliance: string;     // Alliance group key
  shortName?: string;   // Abbreviated name for tight spaces
  status: 'active' | 'coming-soon'; // 'coming-soon' greys out in nav
  description?: string; // One-line flavour text for faction card
}

export interface Alliance {
  id: string;
  label: string;
  accentColor: string;  // CSS hex used for alliance headers and accents
}

export const ALLIANCES: Alliance[] = [
  { id: 'imperium',  label: 'The Imperium',       accentColor: '#c9a84c' },
  { id: 'chaos',     label: 'Forces of Chaos',     accentColor: '#8b2020' },
  { id: 'aeldari',   label: 'The Aeldari',         accentColor: '#3a7bd5' },
  { id: 'xenos',     label: 'Xenos Species',       accentColor: '#2e8b57' },
  { id: 'devourer',  label: 'The Great Devourer',  accentColor: '#7b3fa0' },
];

export const FACTIONS: Faction[] = [
  // ── Imperium ─────────────────────────────────────────────────────────────
  {
    id: 'adeptus-astartes',
    name: 'Adeptus Astartes',
    shortName: 'Space Marines',
    alliance: 'imperium',
    status: 'active',
    description: 'The Angels of Death — genetically engineered warriors of the Emperor.',
  },
  {
    id: 'astra-militarum',
    name: 'Astra Militarum',
    shortName: 'Astra Militarum',
    alliance: 'imperium',
    status: 'active',
    description: 'The countless legions of humanity\'s greatest martial force.',
  },
  {
    id: 'adeptus-ministorum',
    name: 'Adeptus Ministorum',
    shortName: 'Ministorum',
    alliance: 'imperium',
    status: 'active',
    description: 'The faithful warriors of the Ecclesiarchy, sisters of battle.',
  },
  {
    id: 'adeptus-mechanicus',
    name: 'Adeptus Mechanicus',
    shortName: 'Adeptus Mech.',
    alliance: 'imperium',
    status: 'active',
    description: 'The Omnissiah\'s disciples, blending flesh and sacred machine.',
  },
  {
    id: 'adeptus-custodes',
    name: 'Adeptus Custodes',
    shortName: 'Custodes',
    alliance: 'imperium',
    status: 'coming-soon',
    description: 'The Emperor\'s personal guardians — ten thousand golden warriors.',
  },
  {
    id: 'agents-of-the-imperium',
    name: 'Agents of the Imperium',
    shortName: 'Agents',
    alliance: 'imperium',
    status: 'coming-soon',
    description: 'Inquisitors, assassins, and other instruments of Imperial will.',
  },

  // ── Forces of Chaos ───────────────────────────────────────────────────────
  {
    id: 'chaos-undivided',
    name: 'Chaos Undivided',
    shortName: 'Chaos Undivided',
    alliance: 'chaos',
    status: 'active',
    description: 'Traitor legions and renegades pledged to all four Chaos powers.',
  },
  {
    id: 'chaos-daemons',
    name: 'Chaos Daemons',
    shortName: 'Daemons',
    alliance: 'chaos',
    status: 'coming-soon',
    description: 'Manifestations of the Ruinous Powers given murderous form.',
  },

  // ── The Aeldari ───────────────────────────────────────────────────────────
  {
    id: 'asuryani',
    name: 'Asuryani',
    shortName: 'Asuryani',
    alliance: 'aeldari',
    status: 'active',
    description: 'The Craftworld Aeldari — a dying race wielding ancient power.',
  },
  {
    id: 'drukhari',
    name: 'Drukhari',
    shortName: 'Drukhari',
    alliance: 'aeldari',
    status: 'active',
    description: 'The Dark Kin, raiders from Commorragh who feed on suffering.',
  },

  // ── The Great Devourer ────────────────────────────────────────────────────
  {
    id: 'tyranids',
    name: 'Tyranids',
    shortName: 'Tyranids',
    alliance: 'devourer',
    status: 'active',
    description: 'The Shadow in the Warp — an unstoppable extragalactic swarm.',
  },
  {
    id: 'genestealer-cults',
    name: 'Genestealer Cults',
    shortName: 'GSC',
    alliance: 'devourer',
    status: 'active',
    description: 'Hybrid insurgents who pave the way for the Great Devourer.',
  },

  // ── Xenos Species ─────────────────────────────────────────────────────────
  {
    id: 'orks',
    name: 'The Orks',
    shortName: 'Orks',
    alliance: 'xenos',
    status: 'coming-soon',
    description: 'The green tide — brutal, anarchic, and multiplying endlessly.',
  },
  {
    id: 'tau-empire',
    name: "T'au Empire",
    shortName: "T'au",
    alliance: 'xenos',
    status: 'coming-soon',
    description: 'A young, expanding empire united under the Greater Good.',
  },
  {
    id: 'necrons',
    name: 'The Necrontyr',
    shortName: 'Necrons',
    alliance: 'xenos',
    status: 'coming-soon',
    description: 'Ancient undying warriors reawakening to reclaim the galaxy.',
  },
  {
    id: 'leagues-of-votann',
    name: 'Leagues of Votann',
    shortName: 'Votann',
    alliance: 'xenos',
    status: 'coming-soon',
    description: 'The Kin — tenacious miners and warriors of the galactic core.',
  },
];

// Helper: get factions grouped by alliance, in alliance display order
export function getFactionsByAlliance(): Array<{ alliance: Alliance; factions: Faction[] }> {
  return ALLIANCES.map((alliance) => ({
    alliance,
    factions: FACTIONS.filter((f) => f.alliance === alliance.id),
  })).filter((group) => group.factions.length > 0);
}
