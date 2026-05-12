import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import netlify from '@astrojs/netlify';
import rehypeRaw from 'rehype-raw';

export default defineConfig({
  site: 'https://alt-hammer.netlify.app',
  markdown: {
    rehypePlugins: [rehypeRaw],
  },
  integrations: [
    mdx({
      // rehype-raw allows raw HTML in MDX content (e.g. inline <span> tags).
      // It must be configured here on the MDX integration rather than only in
      // markdown.rehypePlugins, because when applied at the markdown level it
      // runs before JSX is resolved and strips component expressions like
      // data={hitData} from Astro component calls in MDX files.
      rehypePlugins: [rehypeRaw],
    }),
  ],
  adapter: netlify(),
});