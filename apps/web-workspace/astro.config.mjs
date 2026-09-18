import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    persistState: true,
  }),
  integrations: [react()],
  vite: {
    ssr: {
      noExternal: ['xlsx-populate', '@planilla/cloudflare', '@planilla/spreadsheets'],
    },
  },
});
