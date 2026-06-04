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
    vision_run_count: 2,
    refine_call_count: 1,
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
    })
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
      { ok: true, body: { data: { profile: { id: USER_ID, display_name: 'Nowa Nazwa' } } } }
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nowa Nazwa' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-display-name-success')).toBeInTheDocument()
    );
    expect(input.value).toBe('Nowa Nazwa');
  });

  it('rollback display_name do ostatnio zapisanej wartości przy błędzie 400', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      { ok: false, body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid profile input.' } } }
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nowa Nazwa' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-display-name-error')).toBeInTheDocument()
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
      expect(screen.getByTestId('account-display-name-error')).toBeInTheDocument()
    );
    // Tylko call stats (mount) — PATCH nie wywołany
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe('AccountIsland — stats', () => {
  it('renderuje blok statystyk z danymi po załadowaniu', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() =>
      expect(screen.getByTestId('account-stats-content')).toBeInTheDocument()
    );
    expect(screen.getByTestId('account-stats-total')).toBeInTheDocument();
  });

  it('pokazuje błąd gdy stats request zwróci error', async () => {
    stubFetch({ ok: false, body: { error: { code: 'INTERNAL_ERROR', message: 'fail' } } });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);

    await waitFor(() =>
      expect(screen.getByTestId('account-stats-error')).toBeInTheDocument()
    );
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

    await waitFor(() =>
      expect(screen.getByTestId('account-email-pending')).toBeInTheDocument()
    );
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

    await waitFor(() =>
      expect(screen.getByTestId('account-email-error')).toBeInTheDocument()
    );
  });

  it('walidacja klient-side — nieprawidłowy email nie wywołuje updateUser', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    fireEvent.change(screen.getByTestId('account-new-email-input'), {
      target: { value: 'nie-email' },
    });
    fireEvent.click(screen.getByTestId('account-email-save'));

    await waitFor(() =>
      expect(screen.getByTestId('account-email-error')).toBeInTheDocument()
    );
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
      expect(screen.getByTestId('account-password-field-error')).toBeInTheDocument()
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

    await waitFor(() =>
      expect(screen.getByTestId('account-password-success')).toBeInTheDocument()
    );
    expect(
      (screen.getByTestId('account-new-password-input') as HTMLInputElement).value
    ).toBe('');
    expect(
      (screen.getByTestId('account-confirm-password-input') as HTMLInputElement).value
    ).toBe('');
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

    await waitFor(() =>
      expect(screen.getByTestId('account-password-error')).toBeInTheDocument()
    );
  });
});
