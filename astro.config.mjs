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
    mdx(),
  ],
  adapter: netlify(),
});