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

  it('klik otwiera panel z linkami, emailem i wylogowaniem', () => {
    render(<MobileNav email={EMAIL} />);
    fireEvent.click(screen.getByTestId('mobile-nav-toggle'));

    expect(screen.getByTestId('mobile-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByTestId('mobile-nav-panel');
    expect(panel).toBeInTheDocument();

    expect(screen.getByTestId('mobile-nav-library')).toHaveAttribute('href', '/library');
    // „Moje półki" to akordeon-button (nie link) — po kliknięciu rozwinięty pokazuje półki
    const shelvesBtn = screen.getByTestId('mobile-nav-shelves');
    expect(shelvesBtn.tagName).toBe('BUTTON');
    expect(shelvesBtn).toHaveAttribute('aria-expanded');
    expect(screen.getByTestId('mobile-nav-upload')).toHaveAttribute('href', '/upload');
    expect(screen.getByTestId('mobile-nav-add-purchase')).toHaveAttribute('href', '/purchase');
    expect(screen.getByTestId('mobile-nav-account')).toHaveAttribute('href', '/account');

    expect(screen.getByTestId('mobile-user-email').textContent).toBe(EMAIL);
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('klik „Moje półki" rozwija listę półek i link „Zarządzaj półkami…"', () => {
    const shelves = [
      { id: 'shelf-1', name: 'Salon' },
      { id: 'shelf-2', name: 'Sypialnia' },
    ];
    render(<MobileNav email={EMAIL} shelves={shelves} />);
    fireEvent.click(screen.getByTestId('mobile-nav-toggle'));

    const shelvesBtn = screen.getByTestId('mobile-nav-shelves');
    // domyślnie zwinięty (currentPath pusty → nie jesteśmy na /shelves)
    expect(shelvesBtn).toHaveAttribute('aria-expanded', 'false');
    // po kliknięciu rozwinięty — widać półki
    fireEvent.click(shelvesBtn);
    expect(shelvesBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Salon')).toBeInTheDocument();
    expect(screen.getByText('Sypialnia')).toBeInTheDocument();
    expect(screen.getByText('Zarządzaj półkami…')).toBeInTheDocument();
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
