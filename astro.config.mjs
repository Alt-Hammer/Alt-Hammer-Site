import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import mdx from '@astrojs/mdx';
import remarkGfm from 'remark-gfm';

export default defineConfig({
  site: 'https://alt-hammer.netlify.app',
  output: 'static',
  adapter: netlify(),
  integrations: [mdx({
    remarkPlugins: [remarkGfm],
    rehypePlugins: [],
    extendMarkdownConfig: (config) => {
      config.options = {
        ...config.options,
        allowHTML: true,
      };
      return config;
    },
  })],
});
