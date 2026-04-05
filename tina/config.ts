{
  name: "keyword"
  label: "Keywords & Abilities"
  path: "src/content/keywords"
  format: "mdx"
  fields: [
    {
      type: "string",
      name: "title",
      label: "Keyword Name",
      isTitle: true,
      required: true,
    },
    {
      type: "string",
      name: "slug",
      label: "Slug (for anchor links, e.g. 'heavy', 'light-cover')",
      required: true,
    },
    {
      type: "string",
      name: "type",
      label: "Keyword Type",
      required: true,
      options: [
        "Model Type",
        "Additional Model Type",
        "Armour Save Ability",
        "Wargear Ability",
        "Terrain Attribute",
        "Terrain Type",
        "Game Condition",
      ],
    },
    {
      type: "string",
      name: "summary",
      label: "Tooltip Summary (1-2 sentences shown on hover)",
      ui: {
        component: "textarea",
      },
    },
    {
      type: "rich-text",
      name: "body",
      label: "Full Rules Text",
      isBody: true,
    }
  ]
}