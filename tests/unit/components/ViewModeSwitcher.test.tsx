import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ViewModeSwitcher } from '../../../src/components/DetectionReview';

describe('ViewModeSwitcher', () => {
  it('renderuje 3 przyciski trybu', () => {
    render(<ViewModeSwitcher mode="cards" onChange={() => {}} />);
    expect(screen.getByTestId('view-mode-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-cards')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-list')).toBeInTheDocument();
    expect(screen.getByTestId('view-mode-tiles')).toBeInTheDocument();
  });

  it('aktywny tryb ma aria-pressed=true, pozostałe false', () => {
    render(<ViewModeSwitcher mode="list" onChange={() => {}} />);
    expect(screen.getByTestId('view-mode-list')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('view-mode-cards')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('view-mode-tiles')).toHaveAttribute('aria-pressed', 'false');
  });

  it('klik woła onChange z wybranym trybem', () => {
    const onChange = vi.fn();
    render(<ViewModeSwitcher mode="cards" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('view-mode-tiles'));
    expect(onChange).toHaveBeenCalledWith('tiles');
  });
});
