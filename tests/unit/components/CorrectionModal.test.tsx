import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CorrectionModal } from '../../../src/components/DetectionReview';

// ---------------------------------------------------------------------------
// CorrectionModal — wrapper z zamknięciem Esc + klik w tło. Treść (CorrectForm)
// testowana osobno; tu weryfikujemy mechanikę modala.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CorrectionModal', () => {
  it('renderuje dzieci wewnątrz dialogu', () => {
    render(
      <CorrectionModal onClose={() => {}}>
        <p data-testid="modal-child">treść</p>
      </CorrectionModal>
    );
    const modal = screen.getByTestId('correction-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('modal-child')).toBeInTheDocument();
  });

  it('Esc woła onClose', () => {
    const onClose = vi.fn();
    render(
      <CorrectionModal onClose={onClose}>
        <span>x</span>
      </CorrectionModal>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('klik w tło (backdrop) woła onClose', () => {
    const onClose = vi.fn();
    render(
      <CorrectionModal onClose={onClose}>
        <span data-testid="inner">x</span>
      </CorrectionModal>
    );
    // klik na panelu (stopPropagation) NIE zamyka
    fireEvent.click(screen.getByTestId('correction-modal'));
    expect(onClose).not.toHaveBeenCalled();
    // klik na backdropie (rodzic panelu) zamyka
    const backdrop = screen.getByTestId('correction-modal').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
