import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { DetectionRow } from '../../../src/components/DetectionReview';
import type { DetectionWithCandidatesDTO } from '../../../src/lib/photos/schema';

// ---------------------------------------------------------------------------
// DetectionRow (tryb Lista) — kompakt 1-linia. Reużywa logiki decyzji co Karty;
// „Popraw"/„Wpisz ręcznie" otwierają modal (nie inline).
// ---------------------------------------------------------------------------

const DET_ID = '00000000-0000-4000-8000-000000000010';
const CAND_ID = '00000000-0000-4000-8000-000000000020';

const candidate = {
  id: CAND_ID,
  source: 'google_books',
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: null,
  isbn13: '9780156027601',
  publisher: 'Harvest',
  publishedYear: 1961,
  coverUrl: null,
  matchScore: 0.9,
  rank: 1,
};

const detMatched: DetectionWithCandidatesDTO = {
  id: DET_ID,
  position_index: 1,
  raw_title: 'Solaris',
  raw_author: 'Lem',
  vision_confidence: 0.95,
  spine_color: null,
  bbox: { x1: 0.1, y1: 0.05, x2: 0.2, y2: 0.95 },
  status: 'matched',
  candidates: [candidate],
  duplicate: null,
};

const detNoMatch: DetectionWithCandidatesDTO = {
  id: '00000000-0000-4000-8000-000000000012',
  position_index: 3,
  raw_title: 'Nieznana',
  raw_author: null,
  vision_confidence: 0.7,
  spine_color: null,
  bbox: null,
  status: 'pending',
  candidates: [],
  duplicate: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DetectionRow — render', () => {
  it('renderuje wiersz z tytułem, autorem i badge pewności', () => {
    render(<DetectionRow detection={detMatched} onDecided={() => {}} />);
    const row = screen.getByTestId('detection-row-1');
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain('Solaris');
    expect(row.textContent).toContain('Stanisław Lem');
    expect(row.textContent).toContain('90%');
  });

  it('renderuje akcje Akceptuj/Odrzuć/Popraw dla dopasowanej detekcji', () => {
    render(<DetectionRow detection={detMatched} onDecided={() => {}} />);
    expect(screen.getByTestId('confirm-button')).toBeInTheDocument();
    expect(screen.getByTestId('reject-button')).toBeInTheDocument();
    expect(screen.getByTestId('correct-button')).toBeInTheDocument();
    expect(screen.getByTestId('refine-button')).toBeInTheDocument();
  });

  it('dla braku matchu pokazuje placeholder + Wpisz ręcznie (bez Akceptuj)', () => {
    render(<DetectionRow detection={detNoMatch} onDecided={() => {}} />);
    expect(screen.getByTestId('no-match-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
    expect(screen.queryByTestId('confirm-button')).not.toBeInTheDocument();
  });
});

describe('DetectionRow — akcje', () => {
  it('klik Akceptuj woła POST /confirm z candidate_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { book_id: 'b1' } }), { status: 200 })
    );
    render(<DetectionRow detection={detMatched} onDecided={() => {}} />);
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/confirm')
      );
      expect(call).toBeDefined();
      const body = JSON.parse(call![1]!.body as string) as { candidate_id: string };
      expect(body.candidate_id).toBe(CAND_ID);
    });
  });

  it('klik Odrzuć woła POST /reject', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { rejected: true } }), { status: 200 })
    );
    render(<DetectionRow detection={detMatched} onDecided={() => {}} />);
    fireEvent.click(screen.getByTestId('reject-button'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/reject')
      );
      expect(call).toBeDefined();
    });
  });

  it('po sukcesie akcji woła onDecided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { rejected: true } }), { status: 200 })
    );
    const onDecided = vi.fn();
    render(<DetectionRow detection={detMatched} onDecided={onDecided} />);
    fireEvent.click(screen.getByTestId('reject-button'));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(DET_ID));
  });

  it('klik Refine woła POST /refine', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { detection: { id: DET_ID } } }), { status: 200 })
    );
    render(<DetectionRow detection={detMatched} onDecided={() => {}} />);
    fireEvent.click(screen.getByTestId('refine-button'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/refine')
      );
      expect(call).toBeDefined();
    });
  });
});

describe('DetectionRow — Popraw przez modal', () => {
  it('klik Popraw otwiera modal z formularzem (nie inline)', () => {
    render(<DetectionRow detection={detMatched} onDecided={() => {}} />);
    expect(screen.queryByTestId('correction-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('correct-button'));
    expect(screen.getByTestId('correction-modal')).toBeInTheDocument();
    expect(screen.getByTestId('correct-form')).toBeInTheDocument();
  });

  it('klik Wpisz ręcznie (brak matchu) otwiera modal z formularzem', () => {
    render(<DetectionRow detection={detNoMatch} onDecided={() => {}} />);
    fireEvent.click(screen.getByTestId('manual-entry-button'));
    expect(screen.getByTestId('correction-modal')).toBeInTheDocument();
    expect(screen.getByTestId('correct-form')).toBeInTheDocument();
  });
});
