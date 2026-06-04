import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('AccountIsland', () => {
  it('renderuje initial display_name w polu', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });
    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    expect(input.value).toBe(INITIAL_DISPLAY_NAME);
  });

  it('zapisuje display_name i pokazuje sukces', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      {
        ok: true,
        body: { data: { profile: { id: USER_ID, display_name: 'Nowa Nazwa' } } },
      }
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nowa Nazwa' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() => expect(screen.getByTestId('account-display-name-success')).toBeInTheDocument());
    expect(input.value).toBe('Nowa Nazwa');
  });

  it('rollback display_name do ostatnio zapisanej wartości przy błędzie 400', async () => {
    stubFetch(
      { ok: true, body: MOCK_STATS },
      {
        ok: false,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid profile input.' } },
      }
    );

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Nowa Nazwa' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() => expect(screen.getByTestId('account-display-name-error')).toBeInTheDocument());
    expect(input.value).toBe(INITIAL_DISPLAY_NAME);
  });

  it('walidacja klient-side — pusty display_name pokazuje błąd bez fetch', async () => {
    stubFetch({ ok: true, body: MOCK_STATS });

    render(<AccountIsland initialDisplayName={INITIAL_DISPLAY_NAME} userEmail={USER_EMAIL} />);
    const input = screen.getByTestId('account-display-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('account-display-name-save'));

    await waitFor(() => expect(screen.getByTestId('account-display-name-error')).toBeInTheDocument());
    // Tylko call stats (mount) — PATCH nie wywołany
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

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
