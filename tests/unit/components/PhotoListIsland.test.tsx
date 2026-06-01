import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import PhotoListIsland from '../../../src/components/PhotoListIsland';
import type { PhotoListItemDTO } from '../../../src/lib/photos/schema';

const SHELF_ID = '00000000-0000-4000-8000-000000000001';
const PHOTO_ID = '00000000-0000-4000-8000-000000000002';

function makePhoto(
  overrides: Pick<PhotoListItemDTO, 'id' | 'stage'> & Partial<PhotoListItemDTO>
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
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PhotoListIsland', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading skeletons then renders empty state when no photos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { photos: [] } })
    );
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    // Skeletons appear while loading
    expect(screen.getByTestId('photo-list-loading')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('photo-list-empty')).toBeInTheDocument()
    );
  });

  it('renders all 4 stages with correct labels', async () => {
    const photos: PhotoListItemDTO[] = [
      makePhoto({ id: 'p1', stage: 'uploaded' }),
      makePhoto({ id: 'p2', stage: 'vision_done', detected_count: 5 }),
      makePhoto({ id: 'p3', stage: 'match_done', detected_count: 5, matched_count: 3 }),
      makePhoto({ id: 'p4', stage: 'confirmed', detected_count: 5, matched_count: 3, confirmed_count: 2 }),
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { photos } })
    );
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId('photo-list')).toBeInTheDocument()
    );

    expect(screen.getByTestId('stage-badge-p1')).toHaveTextContent('Wgrane');
    expect(screen.getByTestId('stage-badge-p2')).toHaveTextContent('Wykryte');
    expect(screen.getByTestId('stage-badge-p3')).toHaveTextContent('Dopasowane');
    expect(screen.getByTestId('stage-badge-p4')).toHaveTextContent('Zatwierdzone');
  });

  it('uploaded stage shows only "Uruchom vision" button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } })
    );
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument()
    );
    expect(screen.queryByTestId(`rerun-vision-${PHOTO_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`run-match-${PHOTO_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`open-review-${PHOTO_ID}`)).not.toBeInTheDocument();
  });

  it('vision_done stage shows match + rerun-vision + open-review buttons', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } })
    );
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`run-match-${PHOTO_ID}`)).toBeInTheDocument()
    );
    expect(screen.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`open-review-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`run-vision-${PHOTO_ID}`)).not.toBeInTheDocument();
  });

  it('confirmed stage shows rerun-match + rerun-vision + open-review buttons', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'confirmed' })] } })
    );
    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`rerun-match-${PHOTO_ID}`)).toBeInTheDocument()
    );
    expect(screen.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`open-review-${PHOTO_ID}`)).toBeInTheDocument();
  });

  it('Run vision triggers POST to correct URL and refetches', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: {}, detections: [] } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } })
      );

    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId(`run-vision-${PHOTO_ID}`));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/photos/${PHOTO_ID}/process`);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    // After refetch, stage changes to vision_done
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/shelves/${SHELF_ID}/photos`);
  });

  it('Re-run vision opens modal and calls fetch only after modal confirm', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: {}, detections: [] } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'vision_done' })] } })
      );

    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`rerun-vision-${PHOTO_ID}`)).toBeInTheDocument()
    );

    // First click — opens custom modal, no process call yet
    fireEvent.click(screen.getByTestId(`rerun-vision-${PHOTO_ID}`));
    expect(screen.getByTestId('photo-rerun-confirm')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only initial list fetch

    // Cancel in modal — still no process call
    fireEvent.click(screen.getByTestId('photo-rerun-confirm-cancel'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second click + modal confirm — process called + refetch
    fireEvent.click(screen.getByTestId(`rerun-vision-${PHOTO_ID}`));
    fireEvent.click(screen.getByTestId('photo-rerun-confirm-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/photos/${PHOTO_ID}/process`);
  });

  it('shows toast on 409 CONFLICT from run vision', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'CONFLICT', message: 'Vision run already in progress.' } },
          409
        )
      );

    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId(`run-vision-${PHOTO_ID}`));

    await waitFor(() =>
      expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toBeInTheDocument()
    );
    expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toHaveTextContent(
      'Run już w toku'
    );
  });

  it('shows toast on 429 rate limit from run vision', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({ data: { photos: [makePhoto({ id: PHOTO_ID, stage: 'uploaded' })] } })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'RATE_LIMITED', message: 'Rate limited.' } },
          429
        )
      );

    render(<PhotoListIsland shelfId={SHELF_ID} shelfName="Salon" />);
    await waitFor(() =>
      expect(screen.getByTestId(`run-vision-${PHOTO_ID}`)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId(`run-vision-${PHOTO_ID}`));

    await waitFor(() =>
      expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toBeInTheDocument()
    );
    expect(screen.getByTestId(`row-toast-${PHOTO_ID}`)).toHaveTextContent(
      'rate limit'
    );
  });
});
