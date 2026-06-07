import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PhotoListIsland from '../../../src/components/PhotoListIsland';
import type { PhotoListItemDTO } from '../../../src/lib/photos/schema';

const SHELF_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_SHELF_ID = '00000000-0000-4000-8000-000000000099';

function makePhoto(
  overrides: Pick<PhotoListItemDTO, 'id' | 'stage'> & Partial<PhotoListItemDTO>,
): PhotoListItemDTO {
  return {
    status: 'processed',
    created_at: '2026-01-01T00:00:00Z',
    thumbnail_url: null,
    detected_count: 0,
    matched_count: 0,
    confirmed_count: 0,
    latest_vision_run: null,
    has_running_run: false,
    legacy_no_hash: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = () => Response;

/**
 * Router fetch po URL+metodzie — odporny na kolejność (PhotoListIsland fetchuje
 * równolegle listę zdjęć i listę półek na mount).
 */
function mockFetch(routes: {
  shelves?: Handler;
  photosList?: Handler | Handler[];
  process?: Handler;
  match?: Handler;
  del?: Handler;
  patch?: Handler;
}) {
  let listIdx = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/shelves') {
      return Promise.resolve(routes.shelves?.() ?? jsonResponse({ data: { shelves: [] } }));
    }
    if (url === `/api/shelves/${SHELF_ID}/photos`) {
      const h = routes.photosList;
      if (Array.isArray(h)) {
        const r = h[Math.min(listIdx, h.length - 1)]();
        listIdx += 1;
        return Promise.resolve(r);
      }
      return Promise.resolve(h?.() ?? jsonResponse({ data: { photos: [] } }));
    }
    if (url === `/api/photos/${PHOTO_ID}/process`) {
      return Promise.resolve(
        routes.process?.() ?? jsonResponse({ data: { photo: {}, detections: [] } }),
      );
    }
    if (url === `/api/photos/${PHOTO_ID}/match`) {
      return Promise.resolve(
        routes.match?.() ?? jsonResponse({ data: { matched: 0, detections: [] } }),
      );
    }
    if (url === `/api/photos/${PHOTO_ID}` && method === 'DELETE') {
      return Promise.resolve(routes.del?.() ?? jsonResponse({ data: { deleted: true } }));
    }
    if (url === `/api/photos/${PHOTO_ID}` && method === 'PATCH') {
      return Promise.resolve(routes.patch?.() ?? jsonResponse({ data: { photo: {} } }));
    }
    return Promise.resolve(jsonResponse({ data: {} }));
  });
}

describe('PhotoListIsland', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('shows loading skeletons then renders empty state when no photos', async () => {
    mockFetch({ photosList: () => jsonResponse({ data: { photos: [] } }) });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    expect(screen.getByTestId('photo-list-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('photo-list-empty')).toBeInTheDocument());
  });

  it('renders all 4 stages with correct labels', async () => {
    const photos: PhotoListItemDTO[] = [
      makePhoto({ id: 'p1', stage: 'uploaded' }),
      makePhoto({ id: 'p2', stage: 'vision_done', detected_count: 5 }),
      makePhoto({ id: 'p3', stage: 'match_done', detected_count: 5, matched_count: 3 }),
      makePhoto({
        id: 'p4',
        stage: 'confirmed',
        detected_count: 5,
        matched_count: 3,
        confirmed_count: 2,
      }),
    ];
    mockFetch({ photosList: () => jsonResponse({ data: { photos } }) });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId('photo-list')).toBeInTheDocument());

    expect(screen.getByTestId('stage-badge-p1')).toHaveTextContent('Wgrane');
    expect(screen.getByTestId('stage-badge-p2')).toHaveTextContent('Wykryte');
    expect(screen.getByTestId('stage-badge-p3')).toHaveTextContent('Dopasowane');
    expect(screen.getByTestId('stage-badge-p4')).toHaveTextContent('Zatwierdzone');
  });

  it('uploaded stage shows "Uruchom vision" + Otwórz + Usuń (no rerun/match)', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`delete-photo-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`open-review-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`rerun-vision-${PHOTO_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`run-match-${PHOTO_ID}`)).not.toBeInTheDocument();
  });

  it('vision_done stage shows match + rerun-vision + open-review buttons', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`run-match-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`open-review-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`run-vision-${PHOTO_ID}`)).not.toBeInTheDocument();
  });

  it('confirmed stage shows rerun-match + rerun-vision + open-review buttons', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'confirmed' })] } }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`rerun-match-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`open-review-${PHOTO_ID}`)).toBeInTheDocument();
  });

  it('Run vision triggers POST to correct URL and refetches', async () => {
    const fetchMock = mockFetch({
      photosList: [
        () => jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } }),
        () =>
          jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } }),
      ],
      process: () => jsonResponse({ data: { photo: {}, detections: [] } }),
    });

    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`run-vision-${PHOTO_ID}`));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/photos/${PHOTO_ID}/process`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // refetch listy po sukcesie → stage vision_done
    await waitFor(() => expect(screen.getByTestId(`run-match-${PHOTO_ID}`)).toBeInTheDocument());
  });

  it('Re-run vision opens modal and calls process only after modal confirm', async () => {
    const fetchMock = mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } }),
      process: () => jsonResponse({ data: { photo: {}, detections: [] } }),
    });

    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`rerun-vision-${PHOTO_ID}`));
    expect(screen.getByTestId('photo-rerun-confirm')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/photos/${PHOTO_ID}/process`,
      expect.anything(),
    );

    fireEvent.click(screen.getByTestId('photo-rerun-confirm-cancel'));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/photos/${PHOTO_ID}/process`,
      expect.anything(),
    );

    fireEvent.click(screen.getByTestId(`rerun-vision-${PHOTO_ID}`));
    fireEvent.click(screen.getByTestId('photo-rerun-confirm-confirm'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/photos/${PHOTO_ID}/process`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('shows toast on 409 CONFLICT from run vision', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } }),
      process: () => jsonResponse({ error: { code: 'CONFLICT', message: 'in progress' } }, 409),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`run-vision-${PHOTO_ID}`));
    await waitFor(() => expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toHaveTextContent('Run już w toku');
  });

  it('shows toast on 429 rate limit from run vision', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } }),
      process: () => jsonResponse({ error: { code: 'RATE_LIMITED', message: 'rate' } }, 429),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`run-vision-${PHOTO_ID}`));
    await waitFor(() => expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toHaveTextContent('rate limit');
  });

  // ── S-29 Phase 3: delete / move / badge / disabled-guard ──────────────────

  it('delete: klik Usuń → modal → confirm woła DELETE i usuwa wiersz', async () => {
    const fetchMock = mockFetch({
      photosList: () =>
        jsonResponse({
          data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done', detected_count: 3 })] },
        }),
      del: () => jsonResponse({ data: { deleted: true } }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`delete-photo-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`delete-photo-${PHOTO_ID}`));
    expect(screen.getByTestId('photo-delete-confirm')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('photo-delete-confirm-confirm'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/photos/${PHOTO_ID}`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`photo-item-${PHOTO_ID}`)).not.toBeInTheDocument(),
    );
  });

  it('delete: cancel zamyka modal bez wywołania DELETE', async () => {
    const fetchMock = mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`delete-photo-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`delete-photo-${PHOTO_ID}`));
    fireEvent.click(screen.getByTestId('photo-delete-confirm-cancel'));

    expect(screen.queryByTestId('photo-delete-confirm')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/photos/${PHOTO_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByTestId(`photo-item-${PHOTO_ID}`)).toBeInTheDocument();
  });

  it('delete: błąd serwera → rollback (wiersz wraca) + toast', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } }),
      del: () => jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }, 500),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`delete-photo-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`delete-photo-${PHOTO_ID}`));
    fireEvent.click(screen.getByTestId('photo-delete-confirm-confirm'));

    await waitFor(() => expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`photo-item-${PHOTO_ID}`)).toBeInTheDocument(); // rollback
  });

  it('move: wybór półki woła PATCH i usuwa wiersz z bieżącej listy', async () => {
    const fetchMock = mockFetch({
      shelves: () =>
        jsonResponse({
          data: {
            shelves: [
              {
                id: SHELF_ID,
                name: 'Salon',
                location: null,
                position_index: 0,
                is_system: false,
                book_count: 0,
                photo_count: 1,
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                id: OTHER_SHELF_ID,
                name: 'Sypialnia',
                location: null,
                position_index: 1,
                is_system: false,
                book_count: 0,
                photo_count: 0,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
          },
        }),
      photosList: () =>
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } }),
      patch: () => jsonResponse({ data: { photo: {} } }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`move-photo-${PHOTO_ID}`)).toBeInTheDocument());

    fireEvent.change(screen.getByTestId(`move-photo-${PHOTO_ID}`), {
      target: { value: OTHER_SHELF_ID },
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/photos/${PHOTO_ID}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`photo-item-${PHOTO_ID}`)).not.toBeInTheDocument(),
    );
  });

  it('badge „Bez hash" widoczny tylko gdy legacy_no_hash', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({
          data: {
            photos: [
              makePhoto({ id: 'legacy', stage: 'uploaded', legacy_no_hash: true }),
              makePhoto({ id: 'fresh', stage: 'uploaded', legacy_no_hash: false }),
            ],
          },
        }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId('photo-list')).toBeInTheDocument());
    expect(screen.getByTestId('legacy-hash-badge-legacy')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-hash-badge-fresh')).not.toBeInTheDocument();
  });

  it('disabled-guard: Usuń/Przenieś wyłączone gdy has_running_run', async () => {
    mockFetch({
      shelves: () =>
        jsonResponse({
          data: {
            shelves: [
              {
                id: SHELF_ID,
                name: 'Salon',
                location: null,
                position_index: 0,
                is_system: false,
                book_count: 0,
                photo_count: 1,
                created_at: '2026-01-01T00:00:00Z',
              },
              {
                id: OTHER_SHELF_ID,
                name: 'Sypialnia',
                location: null,
                position_index: 1,
                is_system: false,
                book_count: 0,
                photo_count: 0,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
          },
        }),
      photosList: () =>
        jsonResponse({
          data: {
            photos: [makePhoto({ id: PHOTO_ID, stage: 'processing', has_running_run: true })],
          },
        }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId(`delete-photo-${PHOTO_ID}`)).toBeInTheDocument());
    expect(screen.getByTestId(`delete-photo-${PHOTO_ID}`)).toBeDisabled();
    expect(screen.getByTestId(`move-photo-${PHOTO_ID}`)).toBeDisabled();
  });

  // M10: klik w miniaturę otwiera propozycje — miniatura jest linkiem do /photos/[id]
  it('miniatura (i placeholder) jest linkiem do /photos/[id]', async () => {
    mockFetch({
      photosList: () =>
        jsonResponse({
          data: {
            photos: [
              makePhoto({ id: PHOTO_ID, stage: 'vision_done', thumbnail_url: 'https://t.png' }),
              makePhoto({ id: 'p-no-thumb', stage: 'uploaded', thumbnail_url: null }),
            ],
          },
        }),
    });
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() => expect(screen.getByTestId('photo-list')).toBeInTheDocument());

    expect(screen.getByTestId(`photo-thumb-link-${PHOTO_ID}`)).toHaveAttribute(
      'href',
      `/photos/${PHOTO_ID}`,
    );
    expect(screen.getByTestId('photo-thumb-link-p-no-thumb')).toHaveAttribute(
      'href',
      '/photos/p-no-thumb',
    );
  });
});
