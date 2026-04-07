import { config, collection, fields } from '@keystatic/core';

export default config({
  storage: {
    kind: 'github',
    repo: {
      owner: 'Alt-Hammer',
      name: 'Alt-Hammer-Site',
    },
  },

  ui: {
    brand: {
      name: 'Alt-Hammer 40,000',
    },
  },

  collections: {

    // ── KEYWORDS & ABILITIES ─────────────────────────────────────────
    keywords: collection({
      label: 'Keywords & Abilities',
      slugField: 'title',
      path: 'src/content/keywords/*',
      format: { contentField: 'body' },
      schema: {
        title: fields.slug({
          name: {
            label: 'Keyword Name',
            description: 'e.g. Heavy, Devastating Wounds, Feel No Pain',
          },
        }),
        type: fields.select({
          label: 'Keyword Type',
          description: 'Which category this keyword belongs to',
          options: [
            { label: 'Model Type', value: 'model-type' },
            { label: 'Additional Model Type', value: 'additional-model-type' },
            { label: 'Armour Save Ability', value: 'armour-save-ability' },
            { label: 'Wargear Ability', value: 'wargear-ability' },
            { label: 'Terrain Attribute', value: 'terrain-attribute' },
            { label: 'Terrain Type', value: 'terrain-type' },
            { label: 'Game Condition', value: 'game-condition' },
          ],
          defaultValue: 'wargear-ability',
        }),
        summary: fields.text({
          label: 'Tooltip Summary',
          description: '1-2 sentences shown when hovering over this keyword in rules text',
          multiline: true,
        }),
        body: fields.markdoc({
          label: 'Full Rules Text',
          description: 'Complete rules text for this keyword',
        }),
      },
    }),

    // ── ACTIONS ──────────────────────────────────────────────────────
    actions: collection({
      label: 'Actions',
      slugField: 'title',
      path: 'src/content/actions/*',
      format: { contentField: 'body' },
      schema: {
        title: fields.slug({
          name: {
            label: 'Action Name',
            description: 'e.g. Move, Shoot, Charge and Fight',
          },
        }),
        apCost: fields.text({
          label: 'Activation Point Cost',
          description: 'e.g. 1, 2, 0',
        }),
        summary: fields.text({
          label: 'Tooltip Summary',
          description: '1-2 sentences shown when hovering over this action in rules text',
          multiline: true,
        }),
        body: fields.markdoc({
          label: 'Full Rules Text',
          description: 'Complete rules text for this action',
        }),
      },
    }),

    // ── RULES PAGES ──────────────────────────────────────────────────
    rules: collection({
      label: 'Rules Pages',
      slugField: 'title',
      path: 'src/content/rules/*',
      format: { contentField: 'body' },
      schema: {
        title: fields.slug({
          name: {
            label: 'Page Title',
          },
        }),
        description: fields.text({
          label: 'Meta Description',
          description: 'Shown in search engine results',
        }),
        body: fields.markdoc({
          label: 'Page Content',
        }),
      },
    }),

    // ── FACTIONS ─────────────────────────────────────────────────────
    factions: collection({
      label: 'Factions',
      slugField: 'title',
      path: 'src/content/factions/*',
      format: { contentField: 'body' },
      schema: {
        title: fields.slug({
          name: {
            label: 'Faction Name',
            description: 'e.g. Adeptus Astartes, Astra Militarum',
          },
        }),
        alliance: fields.select({
          label: 'Alliance',
          options: [
            { label: 'The Imperium', value: 'imperium' },
            { label: 'Forces of Chaos', value: 'chaos' },
            { label: 'The Aeldari', value: 'aeldari' },
            { label: 'Xenos Species', value: 'xenos' },
            { label: 'The Great Devourer', value: 'devourer' },
          ],
          defaultValue: 'imperium',
        }),
        status: fields.select({
          label: 'Status',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Coming Soon', value: 'coming-soon' },
          ],
          defaultValue: 'coming-soon',
        }),
        description: fields.text({
          label: 'Short Description',
          description: 'One sentence shown on faction cards on the homepage',
          multiline: true,
        }),
        armyRules: fields.markdoc({
          label: 'Army Rules',
        }),
        detachmentTraits: fields.markdoc({
          label: 'Detachment Traits',
        }),
        wargear: fields.markdoc({
          label: 'Wargear Upgrades',
        }),
        body: fields.markdoc({
          label: 'Unit Profiles',
        }),
      },
    }),

  },
});