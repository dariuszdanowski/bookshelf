import { defineConfig } from 'vitest/config';

// Scoped config dla Stryker mutation testing (plan certyfikacyjny P3, M3L2).
// Mutujemy wyłącznie src/lib/matching/ (czyste funkcje), więc ładujemy tylko
// testy tego modułu — pełna suita (76 plików, jsdom) podniosłaby czas runu
// o rząd wielkości bez dodatkowego sygnału. environment: node zamiast jsdom —
// matching nie dotyka DOM; setup.ts (jest-dom matchers) zbędny na tym zbiorze.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/lib/matching/**/*.test.ts'],
  },
});
