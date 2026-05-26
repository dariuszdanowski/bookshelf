import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mutable bag: `vi.mock` factories are hoisted przed jakimkolwiek
// `import`, więc dane konfigurowane per-test musimy trzymać w obiekcie z
// `vi.hoisted` (zwykłe `let foo` poza factory daje TDZ przy hoist).
const mocks = vi.hoisted(() => ({
  env: {} as { PUBLIC_SUPABASE_URL?: string; PUBLIC_SUPABASE_ANON_KEY?: string },
  createServerClient: vi.fn(),
}));

// `'cloudflare:workers'` to virtual module workerd — w Vitest niedostępny bez
// jawnego mocka (analog F-02 lesson "Adaptacje literalne" dla
// `'astro:middleware'`). Bind `env` getter'em, żeby per-test reassign
// `mocks.env = ...` był widoczny w consumer module.
vi.mock('cloudflare:workers', () => ({
  get env() {
    return mocks.env;
  },
}));

vi.mock('@supabase/ssr', async () => {
  const actual =
    await vi.importActual<typeof import('@supabase/ssr')>('@supabase/ssr');
  return {
    ...actual,
    createServerClient: mocks.createServerClient,
  };
});

// Importujemy DOPIERO po vi.mock — moduł `supabase.server.ts` ma top-level
// `import { env } from 'cloudflare:workers'`, więc musi widzieć mocka.
import { createServerSupabaseClient } from '../../../../src/lib/db/supabase.server';

function fakeContext() {
  return {
    request: new Request('http://localhost/'),
    cookies: { set: vi.fn() },
  };
}

beforeEach(() => {
  mocks.env = {};
  mocks.createServerClient.mockClear();
  mocks.createServerClient.mockReturnValue({} as never);
  // Sprzątamy build-time env vars z Vite/Vitest (np. wczytane z .env.local
  // czy z env w deploy.yml) — każdy test sam ustawi co potrzebne.
  vi.stubEnv('PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createServerSupabaseClient — env reading', () => {
  it('reads URL + anon key z `cloudflare:workers` env (runtime bindings) gdy obecne', () => {
    mocks.env = {
      PUBLIC_SUPABASE_URL: 'https://runtime.example.supabase.co',
      PUBLIC_SUPABASE_ANON_KEY: 'runtime-anon-key',
    };
    // Build-time pełne (powinno zostać zignorowane bo runtime ma pierwszeństwo).
    vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://build.example.supabase.co');
    vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', 'build-anon-key');

    createServerSupabaseClient(fakeContext() as never);

    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      'https://runtime.example.supabase.co',
      'runtime-anon-key',
      expect.objectContaining({ cookies: expect.any(Object) })
    );
  });

  it('fallback do `import.meta.env.PUBLIC_*` gdy runtime env puste (Vitest / Astro dev compat)', () => {
    mocks.env = {}; // virtual module dostępny ale bez wartości
    vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://build.example.supabase.co');
    vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', 'build-anon-key');

    createServerSupabaseClient(fakeContext() as never);

    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      'https://build.example.supabase.co',
      'build-anon-key',
      expect.objectContaining({ cookies: expect.any(Object) })
    );
  });

  it('throws z multi-context hintem gdy oba undefined (prod / dev / Vitest)', () => {
    mocks.env = {};
    // build-time też puste — vi.stubEnv('', '') już ustawione w beforeEach.

    let caught: Error | null = null;
    try {
      createServerSupabaseClient(fakeContext() as never);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/Brak PUBLIC_SUPABASE_URL/);
    // Hint dla wszystkich 3 kontekstów uruchomienia:
    expect(caught?.message).toMatch(/Cloudflare Dashboard/);
    expect(caught?.message).toMatch(/\.dev\.vars/);
    expect(caught?.message).toMatch(/Vitest/);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
