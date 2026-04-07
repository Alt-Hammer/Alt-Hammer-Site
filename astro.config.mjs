import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import netlify from '@astrojs/netlify';

export default defineConfig({
  site: 'https://alt-hammer.netlify.app',
  output: 'server',
  integrations: [react(), keystatic()],
  adapter: netlify(),
});
