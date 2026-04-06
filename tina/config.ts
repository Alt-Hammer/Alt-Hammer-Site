import { defineConfig } from "tinacms";

const branch =
  process.env.TINA_BRANCH ||
  process.env.BRANCH ||
  process.env.HEAD ||
  process.env.GITHUB_BRANCH ||
  process.env.GIT_BRANCH ||
  "main";

console.log("[Tina Config] Resolved branch:", branch, "| TINA_BRANCH:", process.env.TINA_BRANCH, "| BRANCH:", process.env.BRANCH);

export default defineConfig({
  branch,
  clientId: process.env.TINA_PUBLIC_CLIENT_ID,
  token: process.env.TINA_TOKEN,

  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },

  media: {
    tina: {
      mediaRoot: "",
      publicFolder: "public",
    },
  },

  schema: {
    collections: [

      // ── KEYWORDS ────────────────────────────────────────────────────
      {
        name: "keyword",
        label: "Keywords & Abilities",
        path: "src/content/keywords",
        format: "mdx",
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
            label: "Slug (e.g. 'heavy', 'light-cover')",
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
          },
        ],
      },

      // ── ACTIONS ─────────────────────────────────────────────────────
      {
        name: "action",
        label: "Actions",
        path: "src/content/actions",
        format: "mdx",
        fields: [
          {
            type: "string",
            name: "title",
            label: "Action Name",
            isTitle: true,
            required: true,
          },
          {
            type: "string",
            name: "slug",
            label: "Slug (e.g. 'move', 'charge-and-fight')",
            required: true,
          },
          {
            type: "string",
            name: "apCost",
            label: "Activation Point Cost (e.g. '1', '2', '0')",
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
          },
        ],
      },

      // ── RULES PAGES ─────────────────────────────────────────────────
      {
        name: "rules",
        label: "Rules Pages",
        path: "src/content/rules",
        format: "mdx",
        fields: [
          {
            type: "string",
            name: "title",
            label: "Page Title",
            isTitle: true,
            required: true,
          },
          {
            type: "string",
            name: "description",
            label: "Meta Description",
          },
          {
            type: "rich-text",
            name: "body",
            label: "Page Content",
            isBody: true,
          },
        ],
      },

      // ── FACTIONS ────────────────────────────────────────────────────
      {
        name: "faction",
        label: "Factions",
        path: "src/content/factions",
        format: "mdx",
        fields: [
          {
            type: "string",
            name: "title",
            label: "Faction Name",
            isTitle: true,
            required: true,
          },
          {
            type: "string",
            name: "alliance",
            label: "Alliance",
            options: [
              "imperium",
              "chaos",
              "aeldari",
              "xenos",
              "devourer",
            ],
          },
          {
            type: "string",
            name: "status",
            label: "Status",
            options: ["active", "coming-soon"],
          },
          {
            type: "string",
            name: "description",
            label: "Short Description (shown on faction cards)",
            ui: {
              component: "textarea",
            },
          },
          {
            type: "rich-text",
            name: "armyRules",
            label: "Army Rules",
          },
          {
            type: "rich-text",
            name: "detachmentTraits",
            label: "Detachment Traits",
          },
          {
            type: "rich-text",
            name: "wargear",
            label: "Wargear Upgrades",
          },
          {
            type: "rich-text",
            name: "body",
            label: "Unit Profiles",
            isBody: true,
          },
        ],
      },

    ],
  },
});