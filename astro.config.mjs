import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import netlify from '@astrojs/netlify';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

export default defineConfig({
  site: 'https://countermarch.netlify.app',
  integrations: [
    mdx({
      // Use rehype plugins to add stable id slugs and autolink headings
      // to the generated HTML. rehype runs after MDX transforms so these
      // plugins are safe to apply here alongside rehype-raw.
      rehypePlugins: [rehypeRaw, rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'wrap' }]],
    }),
  ],
  adapter: netlify(),
});