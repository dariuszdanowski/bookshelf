import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Hoist przed vi.mock evaluation
const mockUpdateUser = vi.hoisted(() => vi.fn());

vi.mock('../../../src/lib/db/supabase.browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { updateUser: mockUpdateUser },
  }),
}));

import AccountIsland from '../../../src/components/AccountIsland';

const USER_EMAIL = 'test@example.com';
const INITIAL_DISPLAY_NAME = 'Jan Kowalski';
const USER_ID = '00000000-0000-4000-8000-000000000001';

const MOCK_STATS = {
  data: {
    total_vision_cost_usd: 0.015,
    total_refine_cost_usd: 0.002,
    total_resolution_cost_usd: 0,
    vision_run_count: 2,
    refine_call_count: 1,
    resolution_call_count: 0,
  },
};

// Sequences fetch responses in order; last entry repeated for extra calls.
function stubFetch(...responses: Array<{ ok: boolean; body: unknown }>) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      return { ok: r.ok, json: async () => r.body };
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateUser.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('AccountIsland — display_name', () => {
  it('renderuje initial display_name w polu', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    expect(input.value).toBe(INITIAL_DISPLAY_NAME);
  });

  it('zapisuje display_name i pokazuje sukces', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      { ok: true, body: { data: { profile: { id: USER_ID, display_name: 'Nowa Nazwa' } } } },
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nowa Nazwa' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-display-name-success')).toBeInTheDocument(),
    );
    expect(input.value).toBe('Nowa Nazwa');
  });

  it('rollback display_name do ostatnio zapisanej wartości przy błędzie 400', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      {
        ok: false,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid profile input.' } },
      },
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nowa Nazwa' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-display-name-error')).toBeInTheDocument(),
    );
    expect(input.value).toBe(INITIAL_DISPLAY_NAME);
  });

  it('walidacja klient-side — pusty display_name pokazuje błąd bez fetch PATCH', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-display-name-error')).toBeInTheDocument(),
    );
    // Tylko call stats + keys (mount) — PATCH nie wywołany
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});

describe('AccountIsland — limity AI-resolution', () => {
  it('renderuje initial value w polu i wskaźniku zużycia', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    render(
      <AccountIsland
        initialDisplayName={INITIAL_DISPLAY_NAME}
        userEmail={USER_EMAIL}
        initialMaxCallsPerDay={30}
        initialUsageToday={7}
      />,
    );

    expect((screen.getByTestId('account-resolution-max-day-input') as HTMLInputElement).value).toBe(
      '30',
    );
    expect(screen.getByTestId('account-resolution-usage-today')).toHaveTextContent('7 / 30');
  });

  it('renderuje defaulty 20/0 gdy propsy pominięte', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    expect((screen.getByTestId('account-resolution-max-day-input') as HTMLInputElement).value).toBe(
      '20',
    );
    expect(screen.getByTestId('account-resolution-usage-today')).toHaveTextContent('0 / 20');
  });

  it('zapisuje limit i pokazuje sukces', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      { ok: true, body: MOCK_STATS },
      { ok: true, body: { data: { profile: { ai_resolution_max_calls_per_day: 40 } } } },
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-resolution-max-day-input'), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByTestId('account-resolution-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-resolution-limits-success')).toBeInTheDocument(),
    );
  });

  it('walidacja klient-side — wartość poza zakresem pokazuje błąd bez fetch PATCH', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-resolution-max-day-input'), {
      target: { value: '999' },
    });
    fireEvent.click(screen.getByTestId('account-resolution-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-resolution-limits-error')).toBeInTheDocument(),
    );
    // Tylko call stats + keys (mount) — PATCH nie wywołany
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('"Przywróć domyślne" resetuje pole bez fetcha', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(
      <AccountIsland
        initialDisplayName={INITIAL_DISPLAY_NAME}
        userEmail={USER_EMAIL}
        initialMaxCallsPerDay={50}
      />,
    );
    fireEvent.click(screen.getByTestId('account-resolution-restore-defaults'));

    expect((screen.getByTestId('account-resolution-max-day-input') as HTMLInputElement).value).toBe(
      '20',
    );
    // Brak zapisu — tylko mount calls (stats + keys)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('"Wyzeruj dzisiejszy licznik" woła endpoint i aktualizuje wskaźnik', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      { ok: true, body: MOCK_STATS },
      { ok: true, body: { data: { reset_at: '2026-07-16T12:00:00.000Z' } } },
    );

    render(
      <AccountIsland
        initialDisplayName={INITIAL_DISPLAY_NAME}
        userEmail={USER_EMAIL}
        initialUsageToday={4}
      />,
    );
    expect(screen.getByTestId('account-resolution-usage-today')).toHaveTextContent('4 / 20');
    fireEvent.click(screen.getByTestId('account-resolution-reset-usage'));

    await waitFor(() =>
      expect(screen.getByTestId('account-resolution-usage-today')).toHaveTextContent('0 / 20'),
    );
  });
});

describe('AccountIsland — stats', () => {
  it('renderuje blok statystyk z danymi po załadowaniu', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() => expect(screen.getByTestId('account-stats-content')).toBeInTheDocument());
    expect(screen.getByTestId('account-stats-total')).toBeInTheDocument();
  });

  it('pokazuje błąd gdy stats request zwróci error', async () => {
    stubFetch({ ok: false, body: { error: { code: 'INTERNAL_ERROR', message: 'fail' } } });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() => expect(screen.getByTestId('account-stats-error')).toBeInTheDocument());
  });
});

describe('AccountIsland — zmiana emaila', () => {
  it('pokazuje baner pending po udanej zmianie emaila', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    mockUpdateUser.mockResolvedValueOnce({ data: { user: {} }, error: null });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-email-input'), {
      target: { value: 'nowy@example.com' },
    });
    fireEvent.click(screen.getByTestId('account-email-save'));

    await waitFor(() => expect(screen.getByTestId('account-email-pending')).toBeInTheDocument());
  });

  it('pokazuje błąd gdy updateUser zwróci error', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    mockUpdateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Email już zajęty.' },
    });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-email-input'), {
      target: { value: 'zajety@example.com' },
    });
    fireEvent.click(screen.getByTestId('account-email-save'));

    await waitFor(() => expect(screen.getByTestId('account-email-error')).toBeInTheDocument());
  });

  it('walidacja klient-side — nieprawidłowy email nie wywołuje updateUser', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-email-input'), {
      target: { value: 'nie-email' },
    });
    fireEvent.click(screen.getByTestId('account-email-save'));

    await waitFor(() => expect(screen.getByTestId('account-email-error')).toBeInTheDocument());
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe('AccountIsland — zmiana hasła', () => {
  it('niezgodne hasła → błąd klient-side, brak wywołania updateUser', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-password-input'), {
      target: { value: 'Haslo123' },
    });
    fireEvent.change(screen.getByTestId('account-confirm-password-input'), {
      target: { value: 'InneHaslo' },
    });
    fireEvent.click(screen.getByTestId('account-password-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-password-field-error')).toBeInTheDocument(),
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('udana zmiana hasła → pola wyczyszczone + sukces', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    mockUpdateUser.mockResolvedValueOnce({ data: { user: {} }, error: null });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-password-input'), {
      target: { value: 'Haslo123' },
    });
    fireEvent.change(screen.getByTestId('account-confirm-password-input'), {
      target: { value: 'Haslo123' },
    });
    fireEvent.click(screen.getByTestId('account-password-save'));

    await waitFor(() => expect(screen.getByTestId('account-password-success')).toBeInTheDocument());
    expect((screen.getByTestId('account-new-password-input') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('account-confirm-password-input') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('błąd updateUser → formError dla hasła', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    mockUpdateUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Hasło zbyt słabe.' },
    });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-password-input'), {
      target: { value: 'Haslo123' },
    });
    fireEvent.change(screen.getByTestId('account-confirm-password-input'), {
      target: { value: 'Haslo123' },
    });
    fireEvent.click(screen.getByTestId('account-password-save'));

    await waitFor(() => expect(screen.getByTestId('account-password-error')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// M27: suma kosztów per klucz API (chip przy każdym kluczu w sekcji Klucze)
// ---------------------------------------------------------------------------

describe('AccountIsland — koszty per klucz (M27)', () => {
  const KEY_A = '00000000-0000-4000-8000-00000000aaa1';
  const KEY_B = '00000000-0000-4000-8000-00000000bbb2';

  function makeKey(id: string, label: string, isActive: boolean) {
    return {
      id,
      label,
      provider: 'anthropic',
      model: null,
      base_url: null,
      is_active: isActive,
      last_tested_at: null,
      last_test_result: null,
      created_at: '2026-06-01T10:00:00Z',
    };
  }

  it('chip pokazuje sumę z cost_by_key; klucz bez wywołań → $0.0000', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('/api/account/stats')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                total_vision_cost_usd: 0.0244,
                total_refine_cost_usd: 0,
                total_resolution_cost_usd: 0,
                vision_run_count: 3,
                refine_call_count: 0,
                resolution_call_count: 0,
                cost_by_key: { [KEY_A]: { cost_usd: 0.0244, call_count: 3 } },
              },
            }),
          };
        }
        if (u.includes('/api/account/keys')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                keys: [makeKey(KEY_A, 'Mój Anthropic', true), makeKey(KEY_B, 'Zapasowy', false)],
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      }),
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() =>
      expect(screen.getByTestId(`account-key-cost-${KEY_A}`)).toHaveTextContent('$0.0244'),
    );
    expect(screen.getByTestId(`account-key-cost-${KEY_B}`)).toHaveTextContent('$0.0000');
  });
});

// ---------------------------------------------------------------------------
// resolution-openai-compatible-provider: pola request_timeout_ms / max_tokens_override
// w formularzach add/edit klucza (widoczne tylko dla providera != anthropic).
// ---------------------------------------------------------------------------

describe('AccountIsland — formularz kluczy: timeout/max_tokens (resolution-openai-compatible-provider)', () => {
  const KEY_ID = '00000000-0000-4000-8000-00000000cccc';

  function stubKeysRoute(keys: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.includes('/api/account/stats')) {
          return { ok: true, json: async () => MOCK_STATS };
        }
        if (u.includes('/api/account/keys') && (!init || init.method === undefined)) {
          return { ok: true, json: async () => ({ data: { keys } }) };
        }
        if (u.includes('/api/account/keys') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          return { ok: true, json: async () => ({ data: { key: { id: 'new-key', ...body } } }) };
        }
        if (u.includes('/api/account/keys') && init?.method === 'PATCH') {
          return { ok: true, json: async () => ({ data: { key: {} } }) };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      }),
    );
  }

  it('pola timeout/max_tokens niewidoczne dla providera anthropic, widoczne po zmianie na openai_compatible', async () => {
    stubKeysRoute([]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    fireEvent.click(screen.getByTestId('account-keys-add-btn'));
    expect(screen.queryByTestId('account-keys-timeout-input')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('account-keys-provider-select'), {
      target: { value: 'openai_compatible' },
    });

    expect(screen.getByTestId('account-keys-timeout-input')).toBeInTheDocument();
    expect(screen.getByTestId('account-keys-max-tokens-input')).toBeInTheDocument();
  });

  it('wysyła request_timeout_ms i max_tokens_override w POST przy dodawaniu klucza', async () => {
    stubKeysRoute([]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    fireEvent.click(screen.getByTestId('account-keys-add-btn'));
    fireEvent.change(screen.getByTestId('account-keys-label-input'), {
      target: { value: 'Self-hosted relay' },
    });
    fireEvent.change(screen.getByTestId('account-keys-provider-select'), {
      target: { value: 'openai_compatible' },
    });
    fireEvent.change(screen.getByTestId('account-keys-base-url-input'), {
      target: { value: 'https://relay.example.com' },
    });
    fireEvent.change(screen.getByTestId('account-keys-value-input'), {
      target: { value: 'sk-relay' },
    });
    fireEvent.change(screen.getByTestId('account-keys-timeout-input'), {
      target: { value: '60000' },
    });
    fireEvent.change(screen.getByTestId('account-keys-max-tokens-input'), {
      target: { value: '4000' },
    });
    fireEvent.click(screen.getByTestId('account-keys-add-submit'));

    await waitFor(() => {
      const postCall = vi
        .mocked(fetch)
        .mock.calls.find(
          (c) =>
            String(c[0]).includes('/api/account/keys') && (c[1] as RequestInit)?.method === 'POST',
        );
      expect(postCall).toBeDefined();
      const body = JSON.parse(String((postCall?.[1] as RequestInit).body));
      expect(body.request_timeout_ms).toBe(60000);
      expect(body.max_tokens_override).toBe(4000);
    });
  });

  it('formularz edycji pokazuje istniejące wartości timeout/max_tokens i wysyła je w PATCH', async () => {
    stubKeysRoute([
      {
        id: KEY_ID,
        label: 'Self-hosted relay',
        provider: 'openai_compatible',
        model: 'qwen',
        base_url: 'https://relay.example.com',
        is_active: false,
        last_tested_at: null,
        last_test_result: null,
        created_at: '2026-07-01T10:00:00Z',
        request_timeout_ms: 90000,
        max_tokens_override: 5000,
      },
    ]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() =>
      expect(screen.getByTestId(`account-key-edit-btn-${KEY_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`account-key-edit-btn-${KEY_ID}`));

    const timeoutInput = screen.getByTestId(
      `account-key-edit-timeout-${KEY_ID}`,
    ) as HTMLInputElement;
    const maxTokensInput = screen.getByTestId(
      `account-key-edit-max-tokens-${KEY_ID}`,
    ) as HTMLInputElement;
    expect(timeoutInput.value).toBe('90000');
    expect(maxTokensInput.value).toBe('5000');

    fireEvent.change(timeoutInput, { target: { value: '30000' } });
    fireEvent.click(screen.getByTestId(`account-key-edit-save-${KEY_ID}`));

    await waitFor(() => {
      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall?.[1] as RequestInit).body));
      expect(body.request_timeout_ms).toBe(30000);
      expect(body.max_tokens_override).toBe(5000);
    });
  });
});

// ---------------------------------------------------------------------------
// byok-openai-compatible-models: przycisk "Załaduj modele" + klikalna lista
// ze znacznikiem dostępności, w add-formie i edit-formie.
// ---------------------------------------------------------------------------

describe('AccountIsland — model picker (byok-openai-compatible-models)', () => {
  const KEY_ID = '00000000-0000-4000-8000-00000000dddd';
  const MODELS_RESPONSE = {
    data: {
      result: 'ok',
      models: [
        { id: 'model-a', available: true },
        { id: 'model-b', available: false },
      ],
    },
  };

  function stubKeysAndModelsRoute(
    keys: unknown[],
    modelsResponse: { ok: boolean; body: unknown } = { ok: true, body: MODELS_RESPONSE },
  ) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.includes('/api/account/stats')) {
          return { ok: true, json: async () => MOCK_STATS };
        }
        if (u.includes('/api/account/keys/models')) {
          return { ok: modelsResponse.ok, json: async () => modelsResponse.body };
        }
        if (u.includes('/api/account/keys') && (!init || init.method === undefined)) {
          return { ok: true, json: async () => ({ data: { keys } }) };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      }),
    );
  }

  it('przycisk niewidoczny dla anthropic, widoczny i disabled bez base_url/klucza dla openai_compatible (add-form)', async () => {
    stubKeysAndModelsRoute([]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    fireEvent.click(screen.getByTestId('account-keys-add-btn'));
    expect(screen.queryByTestId('account-keys-models-btn')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('account-keys-provider-select'), {
      target: { value: 'openai_compatible' },
    });

    const btn = screen.getByTestId('account-keys-models-btn') as HTMLButtonElement;
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByTestId('account-keys-base-url-input'), {
      target: { value: 'https://relay.example.com' },
    });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByTestId('account-keys-value-input'), {
      target: { value: 'sk-relay' },
    });
    expect(btn).not.toBeDisabled();
  });

  it('add-form: klik ładuje listę z badge’ami dostępności, klik na model wypełnia pole i chowa listę', async () => {
    stubKeysAndModelsRoute([]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    fireEvent.click(screen.getByTestId('account-keys-add-btn'));
    fireEvent.change(screen.getByTestId('account-keys-provider-select'), {
      target: { value: 'openai_compatible' },
    });
    fireEvent.change(screen.getByTestId('account-keys-base-url-input'), {
      target: { value: 'https://relay.example.com/v1' },
    });
    fireEvent.change(screen.getByTestId('account-keys-value-input'), {
      target: { value: 'sk-relay' },
    });
    fireEvent.click(screen.getByTestId('account-keys-models-btn'));

    await waitFor(() => expect(screen.getByTestId('account-keys-models-list')).toBeInTheDocument());
    expect(screen.getByTestId('account-keys-models-badge-0')).toHaveTextContent('Dostępny');
    expect(screen.getByTestId('account-keys-models-badge-1')).toHaveTextContent('Niedostępny');

    const modelsCall = vi
      .mocked(fetch)
      .mock.calls.find((c) => String(c[0]).includes('/api/account/keys/models'));
    expect(modelsCall).toBeDefined();
    const body = JSON.parse(String((modelsCall?.[1] as RequestInit).body));
    expect(body).toMatchObject({
      provider: 'openai_compatible',
      base_url: 'https://relay.example.com/v1',
      key_value: 'sk-relay',
    });

    fireEvent.click(screen.getByTestId('account-keys-models-item-0'));

    expect((screen.getByTestId('account-keys-model-input') as HTMLInputElement).value).toBe(
      'model-a',
    );
    expect(screen.queryByTestId('account-keys-models-list')).not.toBeInTheDocument();
  });

  it('add-form: błąd sieci pokazuje komunikat inline', async () => {
    stubKeysAndModelsRoute([], { ok: false, body: { error: { code: 'INTERNAL_ERROR' } } });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    fireEvent.click(screen.getByTestId('account-keys-add-btn'));
    fireEvent.change(screen.getByTestId('account-keys-provider-select'), {
      target: { value: 'openai_compatible' },
    });
    fireEvent.change(screen.getByTestId('account-keys-base-url-input'), {
      target: { value: 'https://relay.example.com' },
    });
    fireEvent.change(screen.getByTestId('account-keys-value-input'), {
      target: { value: 'sk-relay' },
    });
    fireEvent.click(screen.getByTestId('account-keys-models-btn'));

    await waitFor(() =>
      expect(screen.getByTestId('account-keys-models-error')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('account-keys-models-list')).not.toBeInTheDocument();
  });

  it('edit-form: pole klucza puste → request idzie z id, nie z key_value', async () => {
    stubKeysAndModelsRoute([
      {
        id: KEY_ID,
        label: 'Self-hosted relay',
        provider: 'openai_compatible',
        model: null,
        base_url: 'https://relay.example.com',
        is_active: false,
        last_tested_at: null,
        last_test_result: null,
        created_at: '2026-07-01T10:00:00Z',
        request_timeout_ms: null,
        max_tokens_override: null,
      },
    ]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() =>
      expect(screen.getByTestId(`account-key-edit-btn-${KEY_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`account-key-edit-btn-${KEY_ID}`));

    const btn = screen.getByTestId(`account-key-edit-models-btn-${KEY_ID}`) as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByTestId(`account-key-edit-models-list-${KEY_ID}`)).toBeInTheDocument(),
    );

    const modelsCall = vi
      .mocked(fetch)
      .mock.calls.find((c) => String(c[0]).includes('/api/account/keys/models'));
    expect(modelsCall).toBeDefined();
    const body = JSON.parse(String((modelsCall?.[1] as RequestInit).body));
    expect(body.id).toBe(KEY_ID);
    expect(body.key_value).toBeUndefined();

    fireEvent.click(screen.getByTestId(`account-key-edit-models-item-${KEY_ID}-1`));
    expect((screen.getByTestId(`account-key-edit-model-${KEY_ID}`) as HTMLInputElement).value).toBe(
      'model-b',
    );
  });

  // Odkryte w manualnej weryfikacji Fazy 3 (2026-07-24): autoComplete="off" jest
  // ignorowane przez Chrome dla pól password — przeglądarka potrafi autofillować
  // WCZEŚNIEJ zapisany klucz do pola "Nowy klucz API (opcjonalnie)", mimo że pole
  // ma pozostać puste ("leave blank to keep unchanged"). Skutek: request do
  // /api/account/keys/models (i sam zapis PATCH) wysyła cudzy/stary klucz zamiast
  // fallbacku na `id`. Fix: autoComplete="new-password" (jedyna wartość, którą
  // Chrome faktycznie respektuje dla pól hasłopodobnych).
  it('pola klucza API (add i edit) mają autoComplete="new-password", nie "off" (blokada autofill)', async () => {
    stubKeysAndModelsRoute([
      {
        id: KEY_ID,
        label: 'Self-hosted relay',
        provider: 'openai_compatible',
        model: null,
        base_url: 'https://relay.example.com',
        is_active: false,
        last_tested_at: null,
        last_test_result: null,
        created_at: '2026-07-01T10:00:00Z',
        request_timeout_ms: null,
        max_tokens_override: null,
      },
    ]);
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    fireEvent.click(screen.getByTestId('account-keys-add-btn'));
    expect(screen.getByTestId('account-keys-value-input')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );

    await waitFor(() =>
      expect(screen.getByTestId(`account-key-edit-btn-${KEY_ID}`)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId(`account-key-edit-btn-${KEY_ID}`));
    expect(screen.getByTestId(`account-key-edit-value-${KEY_ID}`)).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });
});
