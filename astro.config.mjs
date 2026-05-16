import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import netlify from '@astrojs/netlify';
import rehypeRaw from 'rehype-raw';

export default defineConfig({
  site: 'https://alt-hammer.netlify.app',
  integrations: [
    mdx({
      // rehype-raw allows raw HTML in MDX content (e.g. inline <span> tags).
      // Configured here on the MDX integration only — NOT in markdown.rehypePlugins.
      // In Astro 5, markdown plugins cascade into MDX processing, so placing
      // rehype-raw in markdown.rehypePlugins causes it to run before JSX is
      // resolved, stripping Astro component expressions like data={hitData}.
      rehypePlugins: [rehypeRaw],
    }),
  ],
  adapter: netlify(),
});