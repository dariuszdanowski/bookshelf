// @ts-check
import { defineConfig } from 'astro/config';
import { resolve } from 'node:path';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',

  server: { host: true },

  integrations: [react()],

  vite: {
    define: {
      // Build-time constants — zastępowane przez Vite przy kompilacji,
      // dostępne w .astro i React islands bez żadnych env vars w runtime.
      __BUILD_COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    resolve: {
      alias: {
        // Guard against SSR dep prebundle picking production jsx-dev-runtime,
        // which exports jsxDEV as undefined and breaks React islands in dev.
        'react/jsx-dev-runtime': resolve(
          'node_modules/react/cjs/react-jsx-dev-runtime.development.js',
        ),
      },
    },
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['@cf-wasm/photon', '@supabase/supabase-js'],
    },
    ssr: {
      noExternal: ['@anthropic-ai/sdk'],
    },
  },

  adapter: cloudflare(),
});
