import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThemeToggle from '../../../src/components/ThemeToggle';

// M17: ThemeToggle to 3-stanowy segmented control (jasny / systemowy / ciemny).
// 'system' rozwiązuje się do prefers-color-scheme + żywy listener na zmianę.

type MqlMock = {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
};

function mockMatchMedia(matches: boolean): MqlMock {
  const mql: MqlMock = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return mql;
}

describe('ThemeToggle (M17 — 3 stany)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('zapisany dark → segment ciemny aktywny, html.dark ustawione', async () => {
    mockMatchMedia(false);
    window.localStorage.setItem('bookshelf:theme-mode', 'dark');

    render(<ThemeToggle />);

    const darkBtn = await screen.findByTestId('theme-mode-dark');
    expect(darkBtn.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('brak wpisu → default systemowy; klik ciemny zapisuje dark', async () => {
    mockMatchMedia(false);

    render(<ThemeToggle />);

    expect((await screen.findByTestId('theme-mode-system')).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByTestId('theme-mode-dark'));

    expect(screen.getByTestId('theme-mode-dark').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('bookshelf:theme-mode')).toBe('dark');
  });

  it('tryb systemowy z ciemnym OS → html.dark; zmiana OS w sesji przełącza na żywo', async () => {
    const mql = mockMatchMedia(true);
    window.localStorage.setItem('bookshelf:theme-mode', 'system');

    render(<ThemeToggle />);

    await screen.findByTestId('theme-mode-system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    // OS przechodzi na jasny → listener re-aplikuje motyw bez przeładowania
    mql.matches = false;
    const onChange = mql.addEventListener.mock.calls[0]![1] as () => void;
    onChange();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('wyjście z trybu systemowego zdejmuje listener prefers-color-scheme', async () => {
    const mql = mockMatchMedia(false);
    window.localStorage.setItem('bookshelf:theme-mode', 'system');

    render(<ThemeToggle />);
    await screen.findByTestId('theme-mode-light');

    fireEvent.click(screen.getByTestId('theme-mode-light'));

    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(window.localStorage.getItem('bookshelf:theme-mode')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('legacy wpis light → segment jasny aktywny (kompatybilność wstecz)', async () => {
    mockMatchMedia(true); // OS ciemny — jawny light ma wygrać
    window.localStorage.setItem('bookshelf:theme-mode', 'light');

    render(<ThemeToggle />);

    expect((await screen.findByTestId('theme-mode-light')).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
