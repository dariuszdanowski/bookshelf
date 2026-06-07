import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Hoist useBodyScrollLock mock przed import
const mockBodyScrollLock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/components/useBodyScrollLock', () => ({
  useBodyScrollLock: mockBodyScrollLock,
}));

import CostAnalysisModal from '../../../src/components/CostAnalysisModal';

const KEYS = [
  { id: 'key-aaa-00000000-0000-4000-8000-0000000000a1', label: 'Anthropic' },
  { id: 'key-bbb-00000000-0000-4000-8000-0000000000b2', label: 'OpenAI' },
];

const VISION_ITEM = {
  id: 'ev-aaa-00000000-0000-4000-8000-000000000001',
  kind: 'vision' as const,
  model: 'claude-3-5-sonnet',
  cost_usd: 0.01,
  latency_ms: 1200,
  created_at: '2026-06-01T10:00:00Z',
  api_key_id: KEYS[0].id,
  photo_id: 'ph-000000-0000-4000-8000-000000000001',
  detection_id: null,
  raw_title: null,
};

const REFINE_ITEM = {
  id: 'ev-bbb-00000000-0000-4000-8000-000000000002',
  kind: 'refine' as const,
  model: 'claude-3-5-sonnet',
  cost_usd: 0.002,
  latency_ms: 800,
  created_at: '2026-06-01T09:00:00Z',
  api_key_id: null,
  photo_id: null,
  detection_id: 'det-0000-0000-4000-8000-000000000001',
  raw_title: 'Pan Tadeusz',
};

function makeResponse(items: (typeof VISION_ITEM | typeof REFINE_ITEM)[], totalCount?: number) {
  return {
    data: {
      items,
      page: 1,
      page_size: 25,
      total_count: totalCount ?? items.length,
      total_cost_usd: items.reduce((s, i) => s + (i.cost_usd ?? 0), 0),
    },
  };
}

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      void url;
      return { ok, json: async () => body };
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('CostAnalysisModal', () => {
  it('renderuje wiersze vision i OCR z poprawnymi danymi', async () => {
    stubFetch(makeResponse([VISION_ITEM, REFINE_ITEM]));

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Vision')).toBeInTheDocument();
      expect(screen.getByText('OCR')).toBeInTheDocument();
    });

    // link Zdjęcie tylko dla VISION_ITEM (ma photo_id)
    const photoLink = screen.getByTestId(`cost-event-photo-link-${VISION_ITEM.id}`);
    expect(photoLink).toHaveAttribute('href', `/photos/${VISION_ITEM.photo_id}`);

    // REFINE_ITEM nie ma photo_id — brak linka
    expect(screen.queryByTestId(`cost-event-photo-link-${REFINE_ITEM.id}`)).not.toBeInTheDocument();
  });

  it('klucz NULL → „—" w kolumnie klucz', async () => {
    stubFetch(makeResponse([REFINE_ITEM]));

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);

    await waitFor(() => screen.getByText('OCR'));

    // Szukamy "—" w wierszu refine — api_key_id=null
    const row = screen.getByTestId(`cost-event-row-${REFINE_ITEM.id}`);
    expect(row).toHaveTextContent('—');
  });

  it('prefiltr initialKeyId trafia do query stringa fetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => makeResponse([VISION_ITEM]),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CostAnalysisModal keys={KEYS} initialKeyId={KEYS[0].id} onClose={() => {}} />);

    await waitFor(() => screen.getByText('Vision'));

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`key=${KEYS[0].id}`));
  });

  it('zmiana filtra type=refine → refetch z type=refine i reset strony', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url as string);
        return { ok: true, json: async () => makeResponse([VISION_ITEM]) };
      }),
    );

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);
    await waitFor(() => screen.getByText('Vision'));

    fireEvent.click(screen.getByTestId('cost-filter-type-refine'));

    await waitFor(() => {
      const last = calls[calls.length - 1];
      expect(last).toContain('type=refine');
    });
  });

  it('paginacja: Następna → page=2 w fetch URL', async () => {
    const calls: string[] = [];
    // Pierwsza strona ma 26 wyników żeby Następna była aktywna
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url as string);
        return {
          ok: true,
          json: async () => ({
            data: {
              items: [VISION_ITEM],
              page: 1,
              page_size: 25,
              total_count: 26,
              total_cost_usd: 0.01,
            },
          }),
        };
      }),
    );

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('cost-pagination-next'));

    const nextBtn = screen.getByTestId('cost-pagination-next');
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    await waitFor(() => {
      const last = calls[calls.length - 1];
      expect(last).toContain('page=2');
    });
  });

  it('empty state: brak wywołań dla wybranych filtrów', async () => {
    stubFetch({
      data: { items: [], page: 1, page_size: 25, total_count: 0, total_cost_usd: 0 },
    });

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('cost-events-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cost-events-empty')).toHaveTextContent(
      'Brak wywołań dla wybranych filtrów.',
    );
  });

  it('error state: pokazuje komunikat błędu', async () => {
    stubFetch({ error: { message: 'Błąd serwera' } }, false);

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('cost-events-error')).toBeInTheDocument();
    });
  });

  it('„Spróbuj ponownie" po błędzie realnie ponawia fetch (fix F1: nie setPage-bailout)', async () => {
    // 1. wywołanie → error; 2. (retry) → sukces
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Błąd serwera' } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => makeResponse([VISION_ITEM]) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('cost-events-error')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('cost-events-retry'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('cost-events-error')).not.toBeInTheDocument();
      expect(screen.getByText('Vision')).toBeInTheDocument();
    });
  });

  it('ESC wywołuje onClose', async () => {
    stubFetch(makeResponse([]));
    const onClose = vi.fn();

    render(<CostAnalysisModal keys={KEYS} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('klik w overlay (tło) wywołuje onClose', async () => {
    stubFetch(makeResponse([]));
    const onClose = vi.fn();

    render(<CostAnalysisModal keys={KEYS} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cost-analysis-modal-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it('klik w panel modalu NIE wywołuje onClose', async () => {
    stubFetch(makeResponse([]));
    const onClose = vi.fn();

    render(<CostAnalysisModal keys={KEYS} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cost-analysis-modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('przycisk Zamknij wywołuje onClose', async () => {
    stubFetch(makeResponse([]));
    const onClose = vi.fn();

    render(<CostAnalysisModal keys={KEYS} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cost-analysis-modal-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('summary: N wywołań · suma $X', async () => {
    stubFetch(makeResponse([VISION_ITEM, REFINE_ITEM], 2));

    render(<CostAnalysisModal keys={KEYS} onClose={() => {}} />);

    await waitFor(() => {
      const summary = screen.getByTestId('cost-events-summary');
      expect(summary).toHaveTextContent('2 wywołań');
      expect(summary).toHaveTextContent('suma');
    });
  });
});
