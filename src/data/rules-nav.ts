// src/data/rules-nav.ts
// Defines the Core Rules navigation structure.
//
// STRUCTURE
// ─────────
// Each RulesSection entry corresponds to one Heading 1 section in the Core
// Rules Word document and maps to a dedicated page at /rules/<slug>.
//
// The 'items' array lists the Heading 2 subsections within that page, used
// by the sidebar (always-visible indented sub-items) and by the sticky H2
// navbar that appears at the top of each rules page.
//
// The Introduction section is deliberately excluded from RULES_SECTIONS —
// its content is embedded on the homepage (index.astro) above the tile grid
// rather than appearing as a separate rules page in the nav.
//
// HOW TO UPDATE
// ─────────────
// Re-run scripts/convert_rules.py after editing the Word document.
// Then update the items[] arrays here to match any new/changed Heading 2s.
// The href and slug values must match the slugified Heading 1 text exactly.

export interface RulesNavItem {
  label: string;
  anchor: string;   // anchor on the parent page, e.g. "#force-organization"
}

export interface RulesSection {
  label: string;
  href: string;      // page route — must be /rules/<slug>
  slug: string;      // matches the 'section' frontmatter field in the .mdx file
  items: RulesNavItem[];
}

export const RULES_SECTIONS: RulesSection[] = [
  {
    label: 'Preparing Your Game',
    href: '/rules/preparing-your-game',
    slug: 'preparing-your-game',
    items: [
      { label: 'Force Organization', anchor: '#force-organization' },
      { label: 'Pregame Setup',      anchor: '#pregame-setup' },
    ],
  },
  {
    label: 'The Battle Round',
    href: '/rules/the-battle-round',
    slug: 'the-battle-round',
    items: [
      { label: 'Command Phase',      anchor: '#phase-1-command-phase' },
      { label: 'Activation Phase',   anchor: '#phase-2-activation-phase' },
      { label: 'Determine Initiative', anchor: '#phase-3-determine-the-initiative-for-the-next-battle-round' },
    ],
  },
  {
    label: 'Actions & Activation Points',
    href: '/rules/actions-activation-points',
    slug: 'actions-activation-points',
    items: [
      { label: 'Core Actions',      anchor: '#core-actions' },
      { label: 'Bonus Activations', anchor: '#bonus-activations' },
    ],
  },
  {
    label: 'Model & Weapon Characteristics',
    href: '/rules/model-weapon-characteristics',
    slug: 'model-weapon-characteristics',
    items: [
      { label: 'Model Characteristics',  anchor: '#model-characteristics' },
      { label: 'Weapon Characteristics', anchor: '#weapon-characteristics' },
    ],
  },
  {
    label: 'Keywords & Abilities',
    href: '/rules/keywords-abilities',
    slug: 'keywords-abilities',
    items: [
      { label: 'Model Characteristics',    anchor: '#model-characteristics' },
      { label: 'Armour Save Abilities',    anchor: '#armour-save-abilities' },
      { label: 'Wargear Abilities',        anchor: '#wargear-abilities' },
      { label: 'Terrain Attributes & Types', anchor: '#terrain-attributes-types' },
    ],
  },
  {
    label: 'Making Attacks',
    href: '/rules/making-attacks',
    slug: 'making-attacks',
    items: [
      { label: 'Attack Sequence',   anchor: '#general-sequence-of-operations-for-making-attacks' },
      { label: 'Shooting Attacks',  anchor: '#shooting-attacks' },
      { label: 'Melee Attacks',     anchor: '#melee-attacks' },
    ],
  },
  {
    label: 'Psychic Attacks & Psykers',
    href: '/rules/psychic-attacks-abilities-psykers',
    slug: 'psychic-attacks-abilities-psykers',
    items: [],
  },
  {
    label: 'Battle Shock',
    href: '/rules/battle-shock',
    slug: 'battle-shock',
    items: [],
  },
  {
    label: 'Strategic Reserves',
    href: '/rules/strategic-reserves',
    slug: 'strategic-reserves',
    items: [],
  },
  {
    label: 'Command Points & Stratagems',
    href: '/rules/command-points-stratagems',
    slug: 'command-points-stratagems',
    items: [],
  },
  {
    label: 'Generating a Battle',
    href: '/rules/generating-a-battle',
    slug: 'generating-a-battle',
    items: [
      { label: 'Board Size & Deployment Zones', anchor: '#determine-board-size-deployment-zones' },
      { label: 'Attacker, Defender & Zones',    anchor: '#determine-attacker-defender-and-deployment-zones' },
      { label: 'Deploying Units',               anchor: '#deploying-units' },
      { label: 'Primary Mission Objectives',    anchor: '#primary-mission-objectives' },
      { label: 'Optional: Mission Rule',        anchor: '#optional-game-feature-determine-mission-rule' },
      { label: 'Optional: Secondary Objectives', anchor: '#optional-game-feature-secondary-mission-objectives' },
    ],
  },
];
