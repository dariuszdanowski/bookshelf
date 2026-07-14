import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConfirmDialog from '../../../src/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renderuje title/message/przyciski bez children — identycznie jak dziś', () => {
    render(
      <ConfirmDialog
        open
        title="Tytuł"
        message="Wiadomość"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Tytuł')).toBeInTheDocument();
    expect(screen.getByText('Wiadomość')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeInTheDocument();
  });

  it('renderuje children między message a przyciskami gdy podane (per-call-byok-key-override)', () => {
    render(
      <ConfirmDialog open title="Tytuł" message="Wiadomość" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <div data-testid="extra-slot">dodatkowa treść</div>
      </ConfirmDialog>,
    );
    expect(screen.getByTestId('extra-slot')).toBeInTheDocument();
  });

  it('nic nie renderuje gdy open=false', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Tytuł"
        message="Wiadomość"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
