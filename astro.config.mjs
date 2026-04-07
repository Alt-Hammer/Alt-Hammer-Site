import { defineConfig } from 'astro/config';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://alt-hammer.netlify.app',
  output: 'hybrid',
  integrations: [keystatic()],
});
