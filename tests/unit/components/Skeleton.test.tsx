import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from '../../../src/components/Skeleton';

describe('Skeleton', () => {
  it('renders with role="status" and default aria-label "Ładowanie"', () => {
    render(<Skeleton />);
    const el = screen.getByRole('status');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-label', 'Ładowanie');
    // Tailwind base classes from konwencji projektu
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('bg-gray-200');
    expect(el.className).toContain('rounded');
  });

  it('accepts custom className and merges with base classes', () => {
    render(<Skeleton className="my-custom h-8" />);
    const el = screen.getByRole('status');
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('my-custom');
    expect(el.className).toContain('h-8');
  });

  it('applies width and height as inline style when provided', () => {
    render(<Skeleton width={100} height={50} />);
    const el = screen.getByRole('status');
    expect(el).toHaveStyle({ width: '100px', height: '50px' });
  });

  it('accepts custom aria-label override', () => {
    render(<Skeleton aria-label="Ładowanie listy książek" />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-label', 'Ładowanie listy książek');
  });
});
