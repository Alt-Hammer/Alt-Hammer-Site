// src/data/rules-nav.ts
// Defines the Core Rules navigation structure.
// Each entry maps to an anchor (#slug) on the /rules/core-rules page,
// or to a separate page for larger sections.

export interface RulesNavItem {
  label: string;
  anchor?: string;   // anchor on the parent page, e.g. "#command-phase"
  href?: string;     // separate page link, overrides anchor
  children?: RulesNavItem[];
}

export interface RulesSection {
  label: string;
  href: string;      // page route, e.g. "/rules/core-rules"
  items: RulesNavItem[];
}

export const RULES_SECTIONS: RulesSection[] = [
  {
    label: 'Core Rules',
    href: '/rules/core-rules',
    items: [
      { label: 'Introduction', anchor: '#introduction' },
      { label: 'Design Philosophy', anchor: '#design-philosophy' },
      {
        label: 'Preparing Your Game',
        anchor: '#preparing-your-game',
        children: [
          { label: 'Force Organization', anchor: '#force-organization' },
          { label: 'Pregame Setup', anchor: '#pregame-setup' },
        ],
      },
      {
        label: 'The Battle Round',
        anchor: '#the-battle-round',
        children: [
          { label: 'Command Phase', anchor: '#command-phase' },
          { label: 'Activation Phase', anchor: '#activation-phase' },
          { label: 'Determine Initiative', anchor: '#determine-initiative' },
        ],
      },
      {
        label: 'Actions & Activation Points',
        anchor: '#actions-activation-points',
        children: [
          { label: 'Core Actions', anchor: '#core-actions' },
          { label: 'Bonus Activations', anchor: '#bonus-activations' },
        ],
      },
      {
        label: 'Making Attacks',
        anchor: '#making-attacks',
        children: [
          { label: 'Attack Sequence', anchor: '#attack-sequence' },
          { label: 'Armour Saves', anchor: '#armour-saves' },
          { label: 'Mortal Wounds', anchor: '#mortal-wounds' },
          { label: 'Hit Roll Table', anchor: '#hit-roll-table' },
          { label: 'Wound Roll Table', anchor: '#wound-roll-table' },
        ],
      },
      { label: 'Shooting Attacks', anchor: '#shooting-attacks' },
      { label: 'Melee Attacks', anchor: '#melee-attacks' },
      { label: 'Psychic Attacks', anchor: '#psychic-attacks' },
      { label: 'Battle Shock', anchor: '#battle-shock' },
      { label: 'Rally Checks', anchor: '#rally-checks' },
      { label: 'Strategic Reserves', anchor: '#strategic-reserves' },
    ],
  },
  {
    label: 'Keywords & Abilities',
    href: '/rules/keywords',
    items: [
      { label: 'Model Characteristics', anchor: '#model-characteristics' },
      {
        label: 'Core Model Type Keywords',
        anchor: '#core-model-type-keywords',
        children: [
          { label: 'Infantry', anchor: '#infantry' },
          { label: 'Vehicle', anchor: '#vehicle' },
          { label: 'Monster', anchor: '#monster' },
          { label: 'Beast', anchor: '#beast' },
        ],
      },
      {
        label: 'Additional Model Keywords',
        anchor: '#additional-model-keywords',
        children: [
          { label: 'Battleline', anchor: '#battleline' },
          { label: 'Character', anchor: '#character' },
          { label: 'Leader', anchor: '#leader' },
          { label: 'Walker', anchor: '#walker' },
          { label: 'Mounted', anchor: '#mounted' },
          { label: 'Fly / Aircraft', anchor: '#fly-aircraft' },
          { label: 'Deep Strike', anchor: '#deep-strike' },
          { label: 'Infiltrator', anchor: '#infiltrator' },
          { label: 'Scout [X]"', anchor: '#scout' },
          { label: 'Titanic', anchor: '#titanic' },
        ],
      },
      {
        label: 'Armour Save Abilities',
        anchor: '#armour-save-abilities',
        children: [
          { label: 'Invulnerable Save', anchor: '#invulnerable-save' },
          { label: 'Feel No Pain', anchor: '#feel-no-pain' },
        ],
      },
      {
        label: 'Wargear Abilities',
        anchor: '#wargear-abilities',
        children: [
          { label: 'Assault', anchor: '#assault' },
          { label: 'Heavy', anchor: '#heavy' },
          { label: 'Rapid Fire [X]', anchor: '#rapid-fire' },
          { label: 'Sustained Hits [X]', anchor: '#sustained-hits' },
          { label: 'Devastating Wounds', anchor: '#devastating-wounds' },
          { label: 'Lethal Hits', anchor: '#lethal-hits' },
          { label: 'Precision', anchor: '#precision' },
          { label: 'Torrent', anchor: '#torrent' },
          { label: 'Melta [X]', anchor: '#melta' },
          { label: 'Twin-Linked', anchor: '#twin-linked' },
          { label: 'Smoke [X]"', anchor: '#smoke' },
        ],
      },
    ],
  },
  {
    label: 'Terrain',
    href: '/rules/terrain',
    items: [
      { label: 'Terrain Attributes', anchor: '#terrain-attributes' },
      { label: 'Light Cover', anchor: '#light-cover' },
      { label: 'Heavy Cover', anchor: '#heavy-cover' },
      { label: 'Vantage Points', anchor: '#vantage-points' },
      { label: 'Difficult Ground', anchor: '#difficult-ground' },
      { label: 'Obscuring', anchor: '#obscuring' },
      { label: 'Defensible Position', anchor: '#defensible-position' },
      { label: 'Terrain Types', anchor: '#terrain-types' },
    ],
  },
  {
    label: 'Command Points & Stratagems',
    href: '/rules/stratagems',
    items: [
      { label: 'Gaining Command Points', anchor: '#gaining-command-points' },
      { label: 'Spending Command Points', anchor: '#spending-command-points' },
      { label: 'Stratagems List', anchor: '#stratagems-list' },
    ],
  },
  {
    label: 'Generating a Mission',
    href: '/rules/missions',
    items: [
      { label: 'Board Size & Deployment', anchor: '#board-size' },
      { label: 'Deployment Zones', anchor: '#deployment-zones' },
      { label: 'Primary Objectives', anchor: '#primary-objectives' },
      { label: 'Mission Rules', anchor: '#mission-rules' },
      { label: 'Secondary Objectives', anchor: '#secondary-objectives' },
    ],
  },
];
