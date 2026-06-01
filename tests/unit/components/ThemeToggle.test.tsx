import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThemeToggle from '../../../src/components/ThemeToggle';

describe('ThemeToggle', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('loads saved dark mode from localStorage', async () => {
    window.localStorage.setItem('bookshelf:theme-mode', 'dark');

    render(<ThemeToggle />);

    const button = await screen.findByTestId('theme-toggle');
    expect(button.getAttribute('aria-label')).toBe('Przelacz na tryb jasny');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggles from light to dark and stores preference', async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    render(<ThemeToggle />);

    const button = await screen.findByTestId('theme-toggle');
    fireEvent.click(button);

    expect(button.getAttribute('aria-label')).toBe('Przelacz na tryb jasny');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('bookshelf:theme-mode')).toBe('dark');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });
});
