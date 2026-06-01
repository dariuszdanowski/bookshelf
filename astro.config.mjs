// @ts-check
import { defineConfig } from 'astro/config';
import { resolve } from 'node:path';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',

  integrations: [react()],

  vite: {
    resolve: {
      alias: {
        // Guard against SSR dep prebundle picking production jsx-dev-runtime,
        // which exports jsxDEV as undefined and breaks React islands in dev.
        'react/jsx-dev-runtime': resolve('node_modules/react/cjs/react-jsx-dev-runtime.development.js'),
      },
    },
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['@cf-wasm/photon'],
    },
  },

  adapter: cloudflare(),
});
