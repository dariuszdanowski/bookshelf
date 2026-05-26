import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LogoutButton from '../../../src/components/LogoutButton';

describe('LogoutButton', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // jsdom blokuje pełne nadpisanie `window.location`; stub'ujemy własny
    // obiekt z mutowalnym `href`, żeby zweryfikować redirect target.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it('po onClick POST-uje do /api/auth/logout i redirektuje na /login', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<LogoutButton />);
    const button = screen.getByTestId('logout-button');
    button.click();

    // Czekamy aż mikro-zadania (resolve fetch + finally) się odpalą.
    await vi.waitFor(() => {
      expect(window.location.href).toBe('/login');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
    });
  });

  it('redirektuje na /login nawet gdy fetch padnie (idempotent UX)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network blip'));

    render(<LogoutButton />);
    screen.getByTestId('logout-button').click();

    await vi.waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
  });
});
