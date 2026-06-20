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
  matchScore: 0.9,
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
  vision_confidence: 0.8,
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
  vision_confidence: 0.7,
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
      new Response(JSON.stringify(makePhotoResponse()), { status: 200 }),
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
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('bulk-confirm-button'));
    expect(screen.getByTestId('bulk-confirm-button')).toBeInTheDocument();
  });

  it('NIE pokazuje bulk gdy brak kandydatów ≥0.75', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detLow])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-review'));
    expect(screen.queryByTestId('bulk-confirm-button')).not.toBeInTheDocument();
  });

  it('klik bulk-confirm woła POST /confirm-batch z pre-zaznaczonymi', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh, detLow])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { confirmed: [{ detection_id: DET_ID_HIGH, book_id: 'b1' }], skipped: [] },
          }),
          { status: 200 },
        ),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const bulkBtn = await waitFor(() => screen.getByTestId('bulk-confirm-button'));
    fireEvent.click(bulkBtn);

    await waitFor(() => {
      const batchCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('confirm-batch'),
      );
      expect(batchCall).toBeDefined();
      const body = JSON.parse(batchCall![1]!.body as string) as {
        items: { detection_id: string; candidate_id: string }[];
      };
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
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), {
          status: 200,
        }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const confirmBtn = await waitFor(() => screen.getByTestId('confirm-button'));
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/confirm'),
      );
      expect(confirmCall).toBeDefined();
      const body = JSON.parse(confirmCall![1]!.body as string) as { candidate_id: string };
      expect(body.candidate_id).toBe(CAND_HIGH);
    });
  });

  it('po zaakceptowaniu wszystkich detekcji przekierowuje na półkę', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), {
          status: 200,
        }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const confirmBtn = await waitFor(() => screen.getByTestId('confirm-button'));
    fireEvent.click(confirmBtn);

    // defekt-3 (strona pozytywna): redirect następuje gdy ≥1 zaakceptowana
    await waitFor(() => expect(window.location.href).toBe(`/shelves/${SHELF_ID}`));
  });

  it('409 z /confirm pokazuje komunikat o duplikacie', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'CONFLICT', message: 'Masz już tę książkę w katalogu (półka: Salon).' },
          }),
          { status: 409 },
        ),
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
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { rejected: true } }), { status: 200 }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const rejectBtn = await waitFor(() => screen.getByTestId('reject-button'));
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      const rejectCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/reject'),
      );
      expect(rejectCall).toBeDefined();
    });
  });

  it('po Odrzuć pokazuje stan „Odrzucono" z przyciskiem Cofnij (nie zielony ptaszek)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { rejected: true } }), { status: 200 }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const rejectBtn = await waitFor(() => screen.getByTestId('reject-button'));
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(screen.getByTestId('undo-reject-button')).toBeInTheDocument();
    });
    expect(screen.getByText('Odrzucono')).toBeInTheDocument();
    // brak auto-redirectu po odrzuceniu ostatniej detekcji (0 zaakceptowanych)
    expect(window.location.href).toBe('');
  });

  it('klik Cofnij woła POST /unreject i przywraca akcje detekcji', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { rejected: true } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: 'matched' } }), { status: 200 }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const rejectBtn = await waitFor(() => screen.getByTestId('reject-button'));
    fireEvent.click(rejectBtn);

    const undoBtn = await waitFor(() => screen.getByTestId('undo-reject-button'));
    fireEvent.click(undoBtn);

    await waitFor(() => {
      const unrejectCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/unreject'),
      );
      expect(unrejectCall).toBeDefined();
    });
    // wraca do stanu nierozstrzygniętego — przycisk Odrzuć znów dostępny
    await waitFor(() => expect(screen.getByTestId('reject-button')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Podgląd szczegółów kandydata (klik w okładkę)
// ---------------------------------------------------------------------------

describe('DetectionReview — podgląd szczegółów kandydata', () => {
  it('klik w okładkę propozycji otwiera ten sam modal szczegółów', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    const coverBtn = await waitFor(() => screen.getByTestId('candidate-cover-button'));
    expect(screen.queryByTestId('book-modal')).not.toBeInTheDocument();
    fireEvent.click(coverBtn);
    expect(screen.getByTestId('book-modal')).toBeInTheDocument();
    // dane kandydata (candHigh): ISBN widoczny w podglądzie (input read-only)
    expect(screen.getByDisplayValue('9780156027601')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Akcja: Szukaj w sieci
// ---------------------------------------------------------------------------

describe('DetectionReview — web search', () => {
  it('pokazuje „Szukaj w sieci" z linkiem do Google na tytuł+autor w nowej karcie', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    const link = await waitFor(() => screen.getByTestId('web-search-button'));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('google.com/search');
    // używa ODCZYTANYCH danych (raw_title/raw_author), nie proponowanego kandydata
    expect(decodeURIComponent(href)).toContain('Solaris');
    expect(decodeURIComponent(href)).toContain('Lem');
  });

  it('używa odczytanych danych (raw), nie danych kandydata przy błędnym matchu', async () => {
    // raw = „Pocz / Agnieszka LIS", kandydat = błędny „Czy to jest kochanie? / Danuta Bieńkowska"
    const detWrongMatch: DetectionWithCandidatesDTO = {
      id: '00000000-0000-4000-8000-000000000099',
      position_index: 5,
      raw_title: 'Poczekaj mi kochanie',
      raw_author: 'Agnieszka Lis',
      vision_confidence: 0.8,
      spine_color: null,
      bbox: null,
      status: 'matched',
      candidates: [
        {
          id: '00000000-0000-4000-8000-0000000000a0',
          source: 'google_books',
          externalId: 'gb-x',
          title: 'Czy to jest kochanie?',
          authors: ['Danuta Bieńkowska'],
          isbn10: null,
          isbn13: null,
          publisher: null,
          publishedYear: null,
          coverUrl: null,
          matchScore: 0.36,
          rank: 1,
        },
      ],
      duplicate: null,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detWrongMatch])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    const link = await waitFor(() => screen.getByTestId('web-search-button'));
    const decoded = decodeURIComponent(link.getAttribute('href') ?? '');
    expect(decoded).toContain('Poczekaj mi kochanie');
    expect(decoded).toContain('Agnieszka Lis');
    expect(decoded).not.toContain('Danuta Bieńkowska');
    expect(decoded).not.toContain('Czy to jest kochanie');
  });
});

// ---------------------------------------------------------------------------
// Akcja: Refine
// ---------------------------------------------------------------------------

describe('DetectionReview — refine', () => {
  it('ukrywa przycisk Doprecyzuj odczyt gdy bbox === null (identity-first gating)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    // poczekaj aż karta detekcji wyrenderuje się
    await waitFor(() => screen.getByTestId('detection-card-3'));
    // refine-button nie powinien być widoczny bez bboxa (identity-first: refine = crop re-OCR)
    expect(screen.queryByTestId('refine-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('refine-cost-hint')).not.toBeInTheDocument();
  });

  it('pokazuje przycisk Doprecyzuj odczyt dla detekcji z bbox', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('refine-button'));
    expect(screen.getByTestId('refine-button')).toBeInTheDocument();
  });

  it('klik Refine woła POST /refine bez pełnego reloadu strony', async () => {
    const reloadMock = window.location.reload as unknown as ReturnType<typeof vi.fn>;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { applied: true, detection: { id: DET_ID_HIGH, raw_title: 'Solaris (refined)' } },
          }),
          { status: 200 },
        ),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const refineBtn = await waitFor(() => screen.getByTestId('refine-button'));
    fireEvent.click(refineBtn);

    await waitFor(() => {
      const refineCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes(`/api/detections/${DET_ID_HIGH}/refine`),
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detBadBbox])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { applied: false, reason: 'parse_failure' } }), {
          status: 200,
        }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const refineBtn = await waitFor(() => screen.getByTestId('refine-button'));

    expect(refineBtn).not.toBeDisabled();
    fireEvent.click(refineBtn);

    await waitFor(() => {
      const refineCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes(`/api/detections/${DET_ID_HIGH}/refine`),
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
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    const correctBtn = await waitFor(() => screen.getByTestId('correct-button'));
    fireEvent.click(correctBtn);
    expect(screen.getByTestId('correct-form')).toBeInTheDocument();
  });

  it('submit formularza woła POST /correct z field_edit i polami', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), {
          status: 200,
        }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    const correctBtn = await waitFor(() => screen.getByTestId('correct-button'));
    fireEvent.click(correctBtn);

    const titleInput = screen.getByTestId('correct-title');
    fireEvent.change(titleInput, { target: { value: 'Poprawiony Solaris' } });
    fireEvent.click(screen.getByTestId('correct-submit'));

    await waitFor(() => {
      const correctCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/correct'),
      );
      expect(correctCall).toBeDefined();
      const body = JSON.parse(correctCall![1]!.body as string) as {
        mode: string;
        title: string;
        candidate_id: string;
      };
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
      new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('no-match-placeholder'));
    expect(screen.getByTestId('manual-entry-button')).toBeInTheDocument();
  });

  it('klik Wpisz ręcznie otwiera formularz', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('manual-entry-button'));
    fireEvent.click(screen.getByTestId('manual-entry-button'));
    expect(screen.getByTestId('correct-form')).toBeInTheDocument();
  });

  it('submit manual woła POST /correct z mode=manual_entry bez candidate_id', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { book_id: 'b1', shelf_id: SHELF_ID } }), {
          status: 200,
        }),
      );

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('manual-entry-button'));
    fireEvent.click(screen.getByTestId('manual-entry-button'));

    fireEvent.change(screen.getByTestId('correct-title'), {
      target: { value: 'Moja Nieznana Książka' },
    });
    fireEvent.click(screen.getByTestId('correct-submit'));

    await waitFor(() => {
      const correctCall = fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/correct'),
      );
      expect(correctCall).toBeDefined();
      const body = JSON.parse(correctCall![1]!.body as string) as {
        mode: string;
        candidate_id?: string;
      };
      expect(body.mode).toBe('manual_entry');
      expect(body.candidate_id).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// runRerunVision — SSE match po udanym vision
// Nowy flow: /process?skipMatch=1 → EventSource match-stream → reload.
// ---------------------------------------------------------------------------

describe('DetectionReview — runRerunVision auto-match', () => {
  let eseConnectedUrl = '';

  class MockEventSource {
    url: string;
    _listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
    onerror: ((e: Event) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      eseConnectedUrl = url;
      queueMicrotask(() => {
        (this._listeners['done'] ?? []).forEach((h) => h(new MessageEvent('done', { data: '{}' })));
      });
    }

    addEventListener(type: string, handler: (e: MessageEvent) => void) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(handler);
    }

    close() {}
  }

  beforeEach(() => {
    eseConnectedUrl = '';
    Object.defineProperty(global, 'EventSource', {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
  });

  it('po udanym vision otwiera SSE match-stream a potem reload', async () => {
    const reloadMock = window.location.reload as unknown as ReturnType<typeof vi.fn>;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      if (u.includes('/process')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { photo: mockPhoto, detections: [] } }), {
            status: 200,
          }),
        );
      }
      if (u.includes(`/api/photos/${PHOTO_ID}`)) {
        return Promise.resolve(new Response(JSON.stringify(makePhotoResponse()), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-review'));

    // Click "Ponów vision" → ConfirmDialog → confirm
    fireEvent.click(screen.getByTestId('rerun-vision-button'));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByTestId('rerun-vision-confirm-confirm'));

    // Wait for reload (signals full flow vision → SSE → done is complete)
    await waitFor(() => expect(reloadMock).toHaveBeenCalled(), { timeout: 3000 });

    // /process?skipMatch=1 must have been called
    const processCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/process'),
    );
    expect(processCalls.length).toBeGreaterThan(0);
    expect(processCalls[0][0] as string).toContain('skipMatch=1');

    // SSE match-stream must have been connected after /process
    expect(eseConnectedUrl).toContain(`/api/photos/${PHOTO_ID}/match-stream`);
  });

  it('gdy vision zwraca błąd, SSE NIE jest uruchamiane i reload NIE następuje', async () => {
    const reloadMock = window.location.reload as unknown as ReturnType<typeof vi.fn>;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      if (u.includes(`/api/photos/${PHOTO_ID}`) && !u.includes('/process')) {
        return Promise.resolve(new Response(JSON.stringify(makePhotoResponse()), { status: 200 }));
      }
      if (u.includes('/process')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Vision fail' } }),
            { status: 500 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-review'));

    fireEvent.click(screen.getByTestId('rerun-vision-button'));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByTestId('rerun-vision-confirm-confirm'));

    // Wait for error message to appear (vision failed → shows error, no SSE, no reload)
    await waitFor(
      () => {
        const msg = screen.queryByTestId('action-message');
        return msg && msg.textContent && msg.textContent.length > 0;
      },
      { timeout: 3000 },
    );

    expect(reloadMock).not.toHaveBeenCalled();
    expect(eseConnectedUrl).toBe('');
  });
});

// ---------------------------------------------------------------------------
// S-37: initial focus z deep-linku (?detection=)
// ---------------------------------------------------------------------------

describe('DetectionReview — initial focus z deep-linku (S-37)', () => {
  beforeEach(() => {
    // jsdom nie implementuje scrollIntoView — stub na prototypie
    Element.prototype.scrollIntoView = vi.fn();
  });

  // Overlay (a z nim clear-focus-button) renderuje się tylko gdy photo_url present
  function makePhotoResponseWithUrl(detections: DetectionWithCandidatesDTO[] = [detHigh, detLow]) {
    const r = makePhotoResponse(detections);
    return { data: { ...r.data, photo_url: 'https://example.com/shelf.jpg' } };
  }

  it('ustawia fokus overlay gdy initialFocusedDetectionId wskazuje istniejącą detekcję', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponseWithUrl()), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} initialFocusedDetectionId={DET_ID_HIGH} />);
    // clear-focus-button renderuje się wyłącznie w trybie fokus
    await waitFor(() => expect(screen.getByTestId('clear-focus-button')).toBeInTheDocument());
  });

  it('scrolluje listę do karty detekcji z fokusem', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse()), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} initialFocusedDetectionId={DET_ID_HIGH} />);
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('nieznane id → cichy no-op, pełny widok bez fokusu', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponseWithUrl()), { status: 200 }),
    );
    render(
      <DetectionReview
        photoId={PHOTO_ID}
        initialFocusedDetectionId="00000000-0000-4000-8000-0000000000ff"
      />,
    );
    await waitFor(() => screen.getByTestId('photo-overlay'));
    expect(screen.queryByTestId('clear-focus-button')).not.toBeInTheDocument();
  });

  it('brak propa → zachowanie jak dotąd (bez fokusu)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponseWithUrl()), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('photo-overlay'));
    expect(screen.queryByTestId('clear-focus-button')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M12 (mobile-polish): formularz "Szukaj po tytule" zamyka sie po SUKCESIE
// — regresja: odwrocony warunek zamykal go tylko przy braku wynikow, a po
// sukcesie stan przejmowala galaz "z kandydatem" i form wracal na ekran.
// ---------------------------------------------------------------------------

describe('DetectionReview — rematch form close po sukcesie (M12)', () => {
  it('po udanym wyszukiwaniu formularz znika, kandydat widoczny', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      if (u.includes('/rematch') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                applied: true,
                detection: {
                  id: detNoMatch.id,
                  status: 'matched',
                  raw_title: 'Scrum. O zwinnym zarządzaniu projektami',
                  raw_author: 'Mariusz Chrapko',
                },
                candidates: [
                  {
                    id: '00000000-0000-4000-8000-000000000077',
                    source: 'google_books',
                    externalId: 'gb-scrum',
                    title: 'Scrum. O zwinnym zarządzaniu projektami',
                    authors: ['Mariusz Chrapko'],
                    isbn10: null,
                    isbn13: '9788324625192',
                    publisher: 'Helion',
                    publishedYear: 2014,
                    coverUrl: null,
                    matchScore: 1,
                    rank: 1,
                  },
                ],
                duplicate: null,
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
      );
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('no-match-placeholder'));

    fireEvent.click(screen.getByTestId('rematch-button'));
    await waitFor(() => screen.getByTestId('rematch-form'));
    fireEvent.change(screen.getByTestId('rematch-title'), {
      target: { value: 'Scrum. O zwinnym zarządzaniu projektami' },
    });
    fireEvent.click(screen.getByTestId('rematch-submit'));

    // Form znika po sukcesie (nie wraca w gałęzi z kandydatem)
    await waitFor(() => expect(screen.queryByTestId('rematch-form')).not.toBeInTheDocument());
    expect(screen.getAllByText('Scrum. O zwinnym zarządzaniu projektami').length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByTestId('rematch-no-results')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M19: parytet akcji „Szukaj" w trybach Lista i Kafelki — przy istniejącym
// kandydacie (top) Karty miały „Szukaj", a Lista/Kafelki tylko „Popraw".
// ---------------------------------------------------------------------------

describe('DetectionReview — Szukaj w trybach lista/kafelki (M19)', () => {
  beforeEach(() => localStorage.removeItem('bookshelf:detection-view-mode'));
  afterEach(() => localStorage.removeItem('bookshelf:detection-view-mode'));

  it('tryb lista: detekcja z kandydatem ma Popraw + Szukaj', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-card-1'));

    fireEvent.click(screen.getByTestId('view-mode-list'));
    await waitFor(() => screen.getByTestId('detection-row-1'));
    expect(screen.getByTestId('correct-button')).toBeInTheDocument();
    expect(screen.getByTestId('rematch-button')).toBeInTheDocument();
  });

  it('tryb kafelki: detekcja z kandydatem ma Popraw + Szukaj', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detHigh])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-card-1'));

    fireEvent.click(screen.getByTestId('view-mode-tiles'));
    await waitFor(() => screen.getByTestId('detection-tile-1'));
    expect(screen.getByTestId('correct-button')).toBeInTheDocument();
    expect(screen.getByTestId('rematch-button')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M20: detekcja potwierdzona w DB (deep-link S-37 do skatalogowanej książki)
// renderuje od razu widok „dodano" zamiast udawać pending z absurdalnym
// dedupem „Masz już tę książkę w katalogu"; auto-redirect na półkę wymaga
// AKCJI w tej sesji — nie strzela przy wejściu na w pełni potwierdzone zdjęcie.
// ---------------------------------------------------------------------------

describe('DetectionReview — potwierdzone z DB (M20)', () => {
  const detConfirmed: DetectionWithCandidatesDTO = {
    ...detHigh,
    status: 'confirmed',
    duplicate: { type: 'exact' as const },
  };

  it('status confirmed → widok decided (bez przycisków akcji, bez bannera dedup)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(makePhotoResponse([detConfirmed])), { status: 200 }),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-card-1'));

    expect(screen.queryByTestId('accept-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reject-button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Masz już tę książkę/)).not.toBeInTheDocument();
    expect(screen.getByText('Solaris')).toBeInTheDocument();
  });

  it('wszystko potwierdzone w DB → BRAK auto-redirectu na półkę', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify(
          makePhotoResponse([detConfirmed, { ...detLow, status: 'confirmed' as const }]),
        ),
        { status: 200 },
      ),
    );
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('detection-card-1'));

    // redirect ustawiałby window.location.href na /shelves/<id> — ma zostać puste
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.href).toBe('');
  });
});

// ---------------------------------------------------------------------------
// M22: pole „Wydawnictwo" w formularzu „Szukaj po tytule" — przekazywane
// do POST /rematch (server zawęża kaskadę GB przez inpublisher:).
// ---------------------------------------------------------------------------

describe('DetectionReview — rematch z wydawnictwem (M22)', () => {
  it('wpisany publisher trafia do body POST /rematch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      if (u.includes('/rematch') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                applied: false,
                detection: {
                  id: detNoMatch.id,
                  status: 'pending',
                  raw_title: 'Mafalda',
                  raw_author: null,
                },
                candidates: [],
                duplicate: null,
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
      );
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('no-match-placeholder'));

    fireEvent.click(screen.getByTestId('rematch-button'));
    await waitFor(() => screen.getByTestId('rematch-form'));
    fireEvent.change(screen.getByTestId('rematch-title'), { target: { value: 'Mafalda' } });
    fireEvent.change(screen.getByTestId('rematch-publisher'), {
      target: { value: 'Nasza Księgarnia' },
    });
    fireEvent.click(screen.getByTestId('rematch-submit'));

    await waitFor(() => {
      const rematchCall = fetchMock.mock.calls.find(
        ([u, init]) => String(u).includes('/rematch') && init?.method === 'POST',
      );
      expect(rematchCall).toBeDefined();
      const body = JSON.parse(String(rematchCall![1]!.body));
      expect(body.publisher).toBe('Nasza Księgarnia');
      expect(body.title).toBe('Mafalda');
    });
  });

  it('puste pole publisher → null w body (nie pusty string)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const u = typeof url === 'string' ? url : (url as Request).url;
      if (u.includes('/rematch') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                applied: false,
                detection: {
                  id: detNoMatch.id,
                  status: 'pending',
                  raw_title: 'Mafalda',
                  raw_author: null,
                },
                candidates: [],
                duplicate: null,
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(makePhotoResponse([detNoMatch])), { status: 200 }),
      );
    });

    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => screen.getByTestId('no-match-placeholder'));

    fireEvent.click(screen.getByTestId('rematch-button'));
    await waitFor(() => screen.getByTestId('rematch-form'));
    fireEvent.change(screen.getByTestId('rematch-title'), { target: { value: 'Mafalda' } });
    fireEvent.click(screen.getByTestId('rematch-submit'));

    await waitFor(() => {
      const rematchCall = fetchMock.mock.calls.find(
        ([u, init]) => String(u).includes('/rematch') && init?.method === 'POST',
      );
      expect(rematchCall).toBeDefined();
      const body = JSON.parse(String(rematchCall![1]!.body));
      expect(body.publisher).toBeNull();
    });
  });
});
