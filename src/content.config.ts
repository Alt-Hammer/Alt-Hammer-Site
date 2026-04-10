import { defineCollection, z } from 'astro:content';

const rules = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    section: z.string(),
    subsections: z.array(z.string()).nullable().optional(),
  }),
});

const factions = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    alliance: z.string(),
    status: z.enum(['active', 'coming-soon']),
    description: z.string().optional(),
  }),
});

export const collections = { rules, factions };