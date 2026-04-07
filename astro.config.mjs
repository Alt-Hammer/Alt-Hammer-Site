import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://alt-hammer.netlify.app',
  output: 'static',
  adapter: netlify(),
});
