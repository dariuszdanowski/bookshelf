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
    // CJS packages that must be pre-bundled (CJS→ESM transform) for the Workers ESM runtime.
    // Without include, Vite loads them raw from node_modules → "exports is not defined".
    // @anthropic-ai/sdk excluded instead — it ships .mjs exports and is loaded via ssr.external.
    ssr: {
      external: ['@anthropic-ai/sdk'],
    },
    optimizeDeps: {
      include: ['standardwebhooks'],
      exclude: ['@anthropic-ai/sdk'],
    },
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),
});
