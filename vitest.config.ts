import { defineConfig } from 'vitest/config';

// `'cloudflare:workers'` to virtual module workerd dostępny tylko w runtime
// Cloudflare Workers / Astro dev przez @cloudflare/vite-plugin. W Vitest
// dostarczamy minimalny stub (`env: {}`), żeby `import { env } from
// 'cloudflare:workers'` w `src/lib/db/supabase.server.ts` rezolwował się
// poprawnie. Indywidualne testy nadal mogą podmieniać przez `vi.mock`.
const cloudflareWorkersStub = {
  name: 'stub-cloudflare-workers',
  resolveId(id: string) {
    if (id === 'cloudflare:workers') return '\0virtual:cloudflare-workers';
    return null;
  },
  load(id: string) {
    if (id === '\0virtual:cloudflare-workers') return 'export const env = {};';
    return null;
  },
};

export default defineConfig({
  plugins: [cloudflareWorkersStub],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/', 'dist/', '.astro/', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/env.d.ts'],
    },
  },
});
