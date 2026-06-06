import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import MobileNav from '../../../src/components/MobileNav';

const EMAIL = 'test@example.com';

describe('MobileNav (S-28)', () => {
  it('panel domyślnie zamknięty; toggle ma aria-expanded=false', () => {
    render(<MobileNav email={EMAIL} />);
    expect(screen.getByTestId('mobile-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('mobile-nav-panel')).not.toBeInTheDocument();
  });

  it('klik otwiera panel z 5 linkami, emailem i wylogowaniem', () => {
    render(<MobileNav email={EMAIL} />);
    fireEvent.click(screen.getByTestId('mobile-nav-toggle'));

    expect(screen.getByTestId('mobile-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByTestId('mobile-nav-panel');
    expect(panel).toBeInTheDocument();

    expect(screen.getByTestId('mobile-nav-library')).toHaveAttribute('href', '/library');
    expect(screen.getByTestId('mobile-nav-shelves')).toHaveAttribute('href', '/shelves');
    expect(screen.getByTestId('mobile-nav-upload')).toHaveAttribute('href', '/upload');
    expect(screen.getByTestId('mobile-nav-add-purchase')).toHaveAttribute('href', '/purchase');
    expect(screen.getByTestId('mobile-nav-account')).toHaveAttribute('href', '/account');

    expect(screen.getByTestId('mobile-user-email').textContent).toBe(EMAIL);
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('drugi klik zamyka panel', () => {
    render(<MobileNav email={EMAIL} />);
    const toggle = screen.getByTestId('mobile-nav-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('mobile-nav-panel')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('mobile-nav-panel')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('wylogowanie z panelu woła POST /api/auth/logout', () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });

    render(<MobileNav email={EMAIL} />);
    fireEvent.click(screen.getByTestId('mobile-nav-toggle'));
    fireEvent.click(screen.getByTestId('logout-button'));

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    vi.restoreAllMocks();
  });
});
