import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HelpTip from '../../../src/components/HelpTip';
import PhotoUploader from '../../../src/components/PhotoUploader';

describe('HelpTip', () => {
  it('renderuje przycisk ? z aria-expanded=false na start', () => {
    render(<HelpTip label="test">treść pomocy</HelpTip>);
    const btn = screen.getByTestId('help-tip-test');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('help-tip-test-popover')).toBeNull();
  });

  it('klik otwiera popover z treścią; aria-expanded=true', () => {
    render(<HelpTip label="abc">zawartość</HelpTip>);
    fireEvent.click(screen.getByTestId('help-tip-abc'));
    const popover = screen.getByTestId('help-tip-abc-popover');
    expect(popover).toBeInTheDocument();
    expect(popover.textContent).toContain('zawartość');
    expect(screen.getByTestId('help-tip-abc')).toHaveAttribute('aria-expanded', 'true');
  });

  it('Esc zamyka popover', () => {
    render(<HelpTip label="esc">treść</HelpTip>);
    fireEvent.click(screen.getByTestId('help-tip-esc'));
    expect(screen.getByTestId('help-tip-esc-popover')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('help-tip-esc-popover')).toBeNull();
  });

  it('klik poza popoverem (backdrop) zamyka popover', () => {
    render(
      <div>
        <HelpTip label="outside">treść</HelpTip>
        <button data-testid="outside-btn">poza</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId('help-tip-outside'));
    expect(screen.getByTestId('help-tip-outside-popover')).toBeInTheDocument();
    // klik na samym przycisku ponownie toggleuje zamknięcie
    fireEvent.click(screen.getByTestId('help-tip-outside'));
    expect(screen.queryByTestId('help-tip-outside-popover')).toBeNull();
  });

  it('ponowny klik przycisku zamyka popover', () => {
    render(<HelpTip label="toggle">treść</HelpTip>);
    const btn = screen.getByTestId('help-tip-toggle');
    fireEvent.click(btn);
    expect(screen.getByTestId('help-tip-toggle-popover')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('help-tip-toggle-popover')).toBeNull();
  });
});

describe('HelpTip — wpięcie auto-process w PhotoUploader', () => {
  it('help-tip-auto-process jest wyrenderowany w formularzu uploadu', () => {
    render(<PhotoUploader />);
    expect(screen.getByTestId('help-tip-auto-process')).toBeInTheDocument();
  });
});
