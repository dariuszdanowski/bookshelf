import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { useViewMode, ViewModeSwitcher, isViewMode, VIEW_MODES } from '../../../src/components/ViewModeSwitcher';

const KEY = 'bookshelf:test-view-mode';

beforeEach(() => {
  window.localStorage.clear();
});

describe('isViewMode', () => {
  it('akceptuje prawidłowe tryby, odrzuca śmieci', () => {
    for (const m of VIEW_MODES) expect(isViewMode(m)).toBe(true);
    expect(isViewMode('garbage')).toBe(false);
    expect(isViewMode(null)).toBe(false);
    expect(isViewMode(42)).toBe(false);
  });
});

describe('useViewMode', () => {
  it('default = cards w jsdom (brak matchMedia)', () => {
    const { result } = renderHook(() => useViewMode(KEY));
    expect(result.current[0]).toBe('cards');
  });

  it('czyta zapisaną preferencję po mount', () => {
    window.localStorage.setItem(KEY, 'tiles');
    const { result } = renderHook(() => useViewMode(KEY));
    expect(result.current[0]).toBe('tiles');
  });

  it('śmieciowa wartość w localStorage → default cards', () => {
    window.localStorage.setItem(KEY, 'garbage-value');
    const { result } = renderHook(() => useViewMode(KEY));
    expect(result.current[0]).toBe('cards');
  });

  it('setMode zapisuje do localStorage i aktualizuje stan', () => {
    const { result } = renderHook(() => useViewMode(KEY));
    act(() => result.current[1]('list'));
    expect(result.current[0]).toBe('list');
    expect(window.localStorage.getItem(KEY)).toBe('list');
  });

  it('różne klucze są niezależne', () => {
    window.localStorage.setItem('bookshelf:book-view-mode', 'tiles');
    window.localStorage.setItem('bookshelf:detection-view-mode', 'list');
    const { result: book } = renderHook(() => useViewMode('bookshelf:book-view-mode'));
    const { result: det } = renderHook(() => useViewMode('bookshelf:detection-view-mode'));
    expect(book.current[0]).toBe('tiles');
    expect(det.current[0]).toBe('list');
  });
});

describe('ViewModeSwitcher', () => {
  it('renderuje 3 przyciski z domyślnymi testidami i aria-pressed na aktywnym', () => {
    render(<ViewModeSwitcher mode="cards" onChange={() => {}} />);
    expect(screen.getByTestId('view-mode-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-cards')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-mode-list')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('view-mode-tiles')).toHaveAttribute('aria-pressed', 'false');
  });

  it('klik wywołuje onChange z wybranym trybem', () => {
    const onChange = vi.fn();
    render(<ViewModeSwitcher mode="cards" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('view-mode-tiles'));
    expect(onChange).toHaveBeenCalledWith('tiles');
  });

  it('custom testId + itemTestIdPrefix izolują instancję', () => {
    render(<ViewModeSwitcher mode="list" onChange={() => {}} testId="book-view-switcher" itemTestIdPrefix="book-view" />);
    expect(screen.getByTestId('book-view-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('book-view-list')).toHaveAttribute('aria-pressed', 'true');
  });
});
