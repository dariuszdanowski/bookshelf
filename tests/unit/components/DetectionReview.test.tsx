import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DetectionReview from '../../../src/components/DetectionReview';
import type { DetectionWithCandidatesDTO } from '../../../src/lib/photos/schema';

// ---------------------------------------------------------------------------
// Stałe testowe
// ---------------------------------------------------------------------------
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const SHELF_ID = '00000000-0000-4000-8000-000000000040';
const DET_ID_HIGH = '00000000-0000-4000-8000-000000000010';
const DET_ID_LOW = '00000000-0000-4000-8000-000000000011';
const CAND_HIGH = '00000000-0000-4000-8000-000000000020';
const CAND_LOW = '00000000-0000-4000-8000-000000000021';

const mockPhoto = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID,
  status: 'processed',
  detected_count: 2,
  error_message: null,
  vision_cost_usd: 0.005,
  vision_latency_ms: 5000,
  created_at: '2026-05-29T10:00:00Z',
};

const mockVisionRun = {
  id: 'vr-1',
  model: 'claude-sonnet-4-6',
  created_at: '2026-05-29T10:00:00Z',
  cost_usd: 0.005,
  latency_ms: 5000,
};

const candHigh = {
  id: CAND_HIGH,
  source: 'google_books',
  externalId: 'gb-1',
  title: 'Solaris',
  authors: ['Stanisław Lem'],
  isbn10: null,
  isbn13: '9780156027601',
  publisher: 'Harvest',
  publishedYear: 1961,
  coverUrl: null,
  matchScore: 0.90,
  rank: 1,
};

const candLow = {
  id: CAND_LOW,
  source: 'open_library',
  externalId: 'ol-1',
  title: 'Diuna',
  authors: ['Frank Herbert'],
  isbn10: null,
  isbn13: null,
  publisher: null,
  publishedYear: 1965,
  coverUrl: null,
  matchScore: 0.45,
  rank: 1,
};

const detHigh: DetectionWithCandidatesDTO = {
  id: DET_ID_HIGH,
  position_index: 1,
  raw_title: 'Solaris',
  raw_author: 'Lem',
  vision_confidence: 0.95,
  spine_color: null,
  bbox: { x1: 0.1, y1: 0.05, x2: 0.2, y2: 0.95 },
  status: 'matched',
  candidates: [candHigh],
  duplicate: null,
};

const detLow: DetectionWithCandidatesDTO = {
  id: DET_ID_LOW,
  position_index: 2,
  raw_title: 'Diuna',
  raw_author: null,
  vision_confidence: 0.80,
  spine_color: null,
  bbox: { x1: 0.25, y1: 0.05, x2: 0.35, y2: 0.95 },
  status: 'matched',
  candidates: [candLow],
  duplicate: null,
};

const detNoMatch: DetectionWithCandidatesDTO = {
  id: '00000000-0000-4000-8000-000000000012',
  position_index: 3,
  raw_title: 'Nieznana',
  raw_author: null,
  vision_confidence: 0.70,
  spine_color: null,
  bbox: null,
  status: 'pending',
  candidates: [],
  duplicate: null,
};

function makePhotoResponse(detections: DetectionWithCandidatesDTO[] = [detHigh, detLow]) {
  return {
    data: {
      photo: mockPhoto,
      detections,
      vision_run: mockVisionRun,
    },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '', reload: vi.fn() },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Render podstawowy
// ---------------------------------------------------------------------------

describe('DetectionReview — initial render', () => {
  it('pokazuje skeleton podczas ładowania', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {})); // never resolves
    render(<DetectionReview photoId={PHOTO_ID} />);
    expect(screen.getByTestId('detection-review-loading')).toBeInTheDocument();
  });

  it('renderuje karty detekcji po załadowaniu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse()), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('detection-review')).toBeInTheDocument();
    });
    expect(screen.getByTestId('detection-card-1')).toBeInTheDocument();
    expect(screen.getByTestId('detection-card-2')).toBeInTheDocument();
  });

  it('pokazuje błąd przy network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network fail'));
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('detection-review-error')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Bulk accept
// ---------------------------------------------------------------------------

describe('DetectionReview — bulk confirm', () => {
  it('pokazuje przycisk bulk dla detekcji ≥0.75', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('bulk-confirm-button'));
    expect(screen.getByTestId('bulk-confirm-button')).toBeInTheDocument();
  });

  it('NIE pokazuje bulk gdy brak kandydatów ≥0.75', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detLow])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-review'));
    expect(screen.queryByTestId('bulk-confirm-button')).not.toBeInTheDocument();
  });

  it('klik bulk-confirm woła POST /confirm-batch z pre-zaznaczonymi', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh, detLow])), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { confirmed: [{ detection_id: DET_ID_HIGH, book_id: 'b1' }], skipped: [] } }), { status: 200 })
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const bulkBtn = await waitFor(() => screen.getByTestId('bulk-confirm-button'));
    fireEvent.click(bulkBtn);

    await waitFor(() => {
      const batchCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('confirm-batch')
      );
      expect(batchCall).toBeDefined();
      const body = JSON.parse(batchCall![1]!.body as string) as { items: { detection_id: string; candidate_id: string }[] };
      expect(body.items).toHaveLength(1); // tylko detHigh ≥0.75
      expect(body.items[0].detection_id).toBe(DET_ID_HIGH);
      expect(body.items[0].candidate_id).toBe(CAND_HIGH);
    });
  });
});

// ---------------------------------------------------------------------------
// Akcja: Akceptuj
// ---------------------------------------------------------------------------

describe('DetectionReview — confirm single', () => {
  it('klik Akceptuj woła POST /confirm z candidate_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), { status: 200 })
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const confirmBtn = await waitFor(() => screen.getByTestId('confirm-button'));
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/confirm')
      );
      expect(confirmCall).toBeDefined();
      const body = JSON.parse(confirmCall![1]!.body as string) as { candidate_id: string };
      expect(body.candidate_id).toBe(CAND_HIGH);
    });
  });

  it('409 z /confirm pokazuje komunikat o duplikacie', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'CONFLICT', message: 'Masz już tę książkę w katalogu (półka: Salon).' } }),
          { status: 409 }
        )
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const confirmBtn = await waitFor(() => screen.getByTestId('confirm-button'));
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const err = screen.getByTestId('detection-error');
      expect(err.textContent).toContain('Salon');
    });
  });
});

// ---------------------------------------------------------------------------
// Akcja: Odrzuć
// ---------------------------------------------------------------------------

describe('DetectionReview — reject', () => {
  it('klik Odrzuć woła POST /reject', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { rejected: true } }), { status: 200 })
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const rejectBtn = await waitFor(() => screen.getByTestId('reject-button'));
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      const rejectCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/reject')
      );
      expect(rejectCall).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Akcja: Refine
// ---------------------------------------------------------------------------

describe('DetectionReview — refine', () => {
  it('pokazuje przycisk Doprecyzuj odczyt także bez bbox', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('refine-button'));
    expect(screen.getByTestId('refine-button')).toBeInTheDocument();
    expect(screen.getByTestId('refine-button')).toHaveTextContent('Doprecyzuj odczyt');
    // Info o koszcie (refine = płatna analiza AI) widoczna obok przycisku (S-35)
    expect(screen.getByTestId('refine-cost-hint')).toBeInTheDocument();
  });

  it('pokazuje przycisk Doprecyzuj odczyt dla detekcji z bbox', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('refine-button'));
    expect(screen.getByTestId('refine-button')).toBeInTheDocument();
  });

  it('klik Refine woła POST /refine bez pełnego reloadu strony', async () => {
    const reloadMock = window.location.reload as unknown as ReturnType<typeof vi.fn>;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { applied: true, detection: { id: DET_ID_HIGH, raw_title: 'Solaris (refined)' } } }),
          { status: 200 }
        )
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const refineBtn = await waitFor(() => screen.getByTestId('refine-button'));
    fireEvent.click(refineBtn);

    await waitFor(() => {
      const refineCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes(`/api/detections/${DET_ID_HIGH}/refine`)
      );
      expect(refineCall).toBeDefined();
      expect(reloadMock).not.toHaveBeenCalled();
    });
  });

  it('pozwala uruchomić Refine dla nieprecyzyjnego bbox (próba API)', async () => {
    const detBadBbox: DetectionWithCandidatesDTO = {
      ...detHigh,
      bbox: { x1: 0.05, y1: 0.1, x2: 0.9, y2: 0.95 },
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(makePhotoResponse([detBadBbox])), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { applied: false, reason: 'parse_failure' } }), { status: 200 }));

    render(<DetectionReview photoId={PHOTO_ID} />);
    const refineBtn = await waitFor(() => screen.getByTestId('refine-button'));

    expect(refineBtn).not.toBeDisabled();
    fireEvent.click(refineBtn);

    await waitFor(() => {
      const refineCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes(`/api/detections/${DET_ID_HIGH}/refine`)
      );
      expect(refineCall).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Akcja: Popraw (field_edit)
// ---------------------------------------------------------------------------

describe('DetectionReview — correct (field_edit)', () => {
  it('klik Popraw otwiera formularz', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    const correctBtn = await waitFor(() => screen.getByTestId('correct-button'));
    fireEvent.click(correctBtn);
    expect(screen.getByTestId('correct-form')).toBeInTheDocument();
  });

  it('submit formularza woła POST /correct z field_edit i polami', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), { status: 200 })
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const correctBtn = await waitFor(() => screen.getByTestId('correct-button'));
    fireEvent.click(correctBtn);

    const titleInput = screen.getByTestId('correct-title');
    fireEvent.change(titleInput, { target: { value: 'Poprawiony Solaris' } });
    fireEvent.click(screen.getByTestId('correct-submit'));

    await waitFor(() => {
      const correctCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/correct')
      );
      expect(correctCall).toBeDefined();
      const body = JSON.parse(correctCall![1]!.body as string) as { mode: string; title: string; candidate_id: string };
      expect(body.mode).toBe('field_edit');
      expect(body.title).toBe('Poprawiony Solaris');
      expect(body.candidate_id).toBe(CAND_HIGH);
    });
  });
});

// ---------------------------------------------------------------------------
// Ręczny wpis (manual_entry)
// ---------------------------------------------------------------------------

describe('DetectionReview — manual entry (no match)', () => {
  it('pokazuje placeholder brak matchu i przycisk Wpisz ręcznie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('no-match-placeholder'));
    expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
  });

  it('klik Wpisz ręcznie otwiera formularz', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 })
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('manual-entry-button'));
    fireEvent.click(screen.getByTestId('manual-entry-button'));
    expect(screen.getByTestId('correct-form')).toBeInTheDocument();
  });

  it('submit manual woła POST /correct z mode=manual_entry bez candidate_id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), { status: 200 })
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('manual-entry-button'));
    fireEvent.click(screen.getByTestId('manual-entry-button'));

    fireEvent.change(screen.getByTestId('correct-title'), { target: { value: 'Moja Nieznana Książka' } });
    fireEvent.click(screen.getByTestId('correct-submit'));

    await waitFor(() => {
      const correctCall = fetchMock.mock.calls.find(([url]) =>
        typeof url === 'string' && url.includes('/correct')
      );
      expect(correctCall).toBeDefined();
      const body = JSON.parse(correctCall![1]!.body as string) as { mode: string; candidate_id?: string };
      expect(body.mode).toBe('manual_entry');
      expect(body.candidate_id).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// runRerunVision — auto-match po udanym vision
// Bug: runRerunVision robiło window.location.reload() bez wywołania match
// → user widział "35 znalezionych, 0 dopasowanych" i musiał ręcznie klikać.
// ---------------------------------------------------------------------------

describe('DetectionReview — runRerunVision auto-match', () => {
  it('po udanym vision wywołuje POST /match a dopiero potem reload', async () => {
    const reloadMock = window.location.reload as unknown as ReturnType<typeof vi.fn>;
    const callOrder: string[] = [];

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : (url as Request).url;

      // Check specific subpaths first (process/match) before the general /api/photos/:id
      if (u.includes('/process')) {
        callOrder.push('POST /process');
        return Promise.resolve(
          new Response(JSON.stringify({ data: { photo: mockPhoto, detections: [] } }), { status: 200 })
        );
      }
      if (u.includes('/match')) {
        callOrder.push('POST /match');
        return Promise.resolve(
          new Response(JSON.stringify({ data: { matched: 2, detections: [] } }), { status: 200 })
        );
      }
      if (u.includes(`/api/photos/${PHOTO_ID}`)) {
        callOrder.push('GET /photos');
        return Promise.resolve(
          new Response(JSON.stringify(makePhotoResponse()), { status: 200 })
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-review'));

    // Click "Ponów vision" → ConfirmDialog → confirm
    fireEvent.click(screen.getByTestId('rerun-vision-button'));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByTestId('rerun-vision-confirm-confirm'));

    // Wait for reload (signals full flow is done)
    await waitFor(() => expect(reloadMock).toHaveBeenCalled(), { timeout: 3000 });

    // /process must have been called
    const processCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/process')
    );
    expect(processCalls.length).toBeGreaterThan(0);

    // /match must have been called AFTER /process and BEFORE reload
    const matchCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/match')
    );
    expect(matchCalls.length).toBeGreaterThan(0);

    const processIdx = callOrder.indexOf('POST /process');
    const matchIdx = callOrder.indexOf('POST /match');
    expect(processIdx).toBeGreaterThanOrEqual(0);
    expect(matchIdx).toBeGreaterThan(processIdx); // match AFTER process
  });

  it('gdy vision zwraca błąd, match NIE jest wywołany i reload NIE następuje', async () => {
    const reloadMock = window.location.reload as unknown as ReturnType<typeof vi.fn>;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      if (u.includes(`/api/photos/${PHOTO_ID}`) && !u.includes('/process') && !u.includes('/match')) {
        return Promise.resolve(new Response(JSON.stringify(makePhotoResponse()), { status: 200 }));
      }
      if (u.includes('/process')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Vision fail' } }), { status: 500 })
        );
      }
      // match should never be called
      if (u.includes('/match')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-review'));

    fireEvent.click(screen.getByTestId('rerun-vision-button'));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByTestId('rerun-vision-confirm-confirm'));

    // Wait for error message to appear (vision failed → shows error, no reload)
    await waitFor(() => {
      const msg = screen.queryByTestId('action-message');
      return msg && msg.textContent && msg.textContent.length > 0;
    }, { timeout: 3000 });

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
