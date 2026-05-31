import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useDetectionViewMode, VIEW_MODE_STORAGE_KEY } from '../../../src/components/DetectionReview';

// ---------------------------------------------------------------------------
// useDetectionViewMode — persystencja localStorage + responsywny default
//
// Kontekst F2 (plan-review): jsdom NIE ma window.matchMedia. Default MUSI
// spaść do 'cards', inaczej testy review oczekujące kart by padły. Tu jawnie
// stubujemy/usuwamy matchMedia, by zweryfikować obie gałęzie.
//
// Hook testujemy przez komponent-harness z render() (zamiast renderHook —
// adaptacja vs plan: interop vitest+RTL16 nie eksponuje renderHook jako
// named export pod React 19; harness daje ten sam zasięg i jest wzorcem repo).
// ---------------------------------------------------------------------------

function Harness() {
  const [mode, setMode] = useDetectionViewMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button data-testid="set-list" onClick={() => setMode('list')}>
        list
      </button>
      <button data-testid="set-tiles" onClick={() => setMode('tiles')}>
        tiles
      </button>
    </div>
  );
}

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function removeMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  removeMatchMedia();
});

describe('useDetectionViewMode — default responsywny', () => {
  it('default = cards gdy brak matchMedia (jsdom / SSR)', () => {
    removeMatchMedia();
    render(<Harness />);
    expect(screen.getByTestId('mode').textContent).toBe('cards');
  });

  it('default = cards gdy ekran ≥640px', () => {
    stubMatchMedia(true);
    render(<Harness />);
    expect(screen.getByTestId('mode').textContent).toBe('cards');
  });

  it('default = list gdy ekran <640px (mobile)', () => {
    stubMatchMedia(false);
    render(<Harness />);
    expect(screen.getByTestId('mode').textContent).toBe('list');
  });
});

describe('useDetectionViewMode — persystencja localStorage', () => {
  it('czyta zapisaną preferencję przy mount (wygrywa nad defaultem)', () => {
    stubMatchMedia(true); // default byłby 'cards'
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, 'tiles');
    render(<Harness />);
    expect(screen.getByTestId('mode').textContent).toBe('tiles');
  });

  it('setMode zapisuje do localStorage i aktualizuje stan', () => {
    removeMatchMedia();
    render(<Harness />);
    fireEvent.click(screen.getByTestId('set-list'));
    expect(screen.getByTestId('mode').textContent).toBe('list');
    expect(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('list');
  });

  it('śmieciowa wartość w localStorage → fallback do defaultu', () => {
    removeMatchMedia(); // default 'cards'
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, 'garbage-value');
    render(<Harness />);
    expect(screen.getByTestId('mode').textContent).toBe('cards');
  });
});
