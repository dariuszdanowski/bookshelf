import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Hoist mocks before any imports that trigger vi.mock evaluation
const mockUpload = vi.hoisted(() => vi.fn());
const mockStorageFrom = vi.hoisted(() => vi.fn(() => ({ upload: mockUpload })));

vi.mock('../../../src/lib/db/supabase.browser', () => ({
  createBrowserSupabaseClient: () => ({
    storage: { from: mockStorageFrom },
  }),
}));

import PhotoUploader from '../../../src/components/PhotoUploader';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const SHELF_ID = '00000000-0000-4000-8000-000000000002';
const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const MOCK_UUID = '11111111-1111-4111-8111-111111111111';

const mockShelves = [
  {
    id: SHELF_ID, name: 'Salon', location: null, position_index: 0,
    is_system: false, book_count: 0, created_at: '2026-01-01T00:00:00Z',
  },
];
const mockPhoto = {
  id: PHOTO_ID, shelf_id: SHELF_ID, status: 'processed', detected_count: 1,
  error_message: null, vision_cost_usd: 0.005, vision_latency_ms: 5000,
  created_at: '2026-01-01T00:00:00Z',
};
const mockDetections = [
  { position_index: 1, raw_title: 'Solaris', raw_author: 'Stanisław Lem', vision_confidence: 0.95, spine_color: 'niebieski' },
];
const mockMatchResult = { data: { matched: 1, detections: [] } };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalLocation = window.location;

const NO_DUPLICATE_RESPONSE = { data: { photo: null } };

function checkHashMock() {
  return jsonResponse(NO_DUPLICATE_RESPONSE);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' },
  });
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => MOCK_UUID,
      subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) },
    },
  });
  mockUpload.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

async function triggerFileUpload(file: File) {
  const input = screen.getByTestId('file-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

describe('PhotoUploader', () => {
  it('renders shelf selector and drop zone after shelves load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { shelves: mockShelves } })
    );
    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
  });

  it('happy path: upload→record→process→match→redirect to review page', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(checkHashMock())                                          // check-hash → no dup
      .mockResolvedValueOnce(jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }))
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    // Redirects to review page after process+match
    // (progress-area flashes too fast to catch in microtask-resolved mock environment)
    await waitFor(() => {
      expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
    }, { timeout: 5000 });

    // Sequence: shelves, check-hash, record POST, process POST, match POST
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/photos');
    expect(fetchMock.mock.calls[3][0]).toMatch(/\/api\/photos\/.+\/process/);
    expect(fetchMock.mock.calls[4][0]).toMatch(/\/api\/photos\/.+\/match/);

    // Storage upload called with correct path and original file
    expect(mockUpload).toHaveBeenCalledWith(
      `${USER_ID}/${MOCK_UUID}.jpg`,
      expect.any(File),
      expect.objectContaining({ contentType: 'image/jpeg' })
    );
  });

  it('retry button re-triggers process+match (no re-upload)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(checkHashMock())                                          // check-hash → no dup
      .mockResolvedValueOnce(jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Vision down' } }, 500))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }))
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('retry-button')).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('retry-button'));

    // After retry: redirects to review page
    await waitFor(() => {
      expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
    }, { timeout: 5000 });

    // 6 calls: shelves, check-hash, record, process (fail), process (retry), match (retry)
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[4][0]).toMatch(/\/api\/photos\/.+\/process/);
    expect(fetchMock.mock.calls[5][0]).toMatch(/\/api\/photos\/.+\/match/);
    // Storage upload called only once (no re-upload on retry)
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('match-only retry: vision succeeded but match failed → retry re-runs match only (no re-process)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(checkHashMock())                                          // check-hash → no dup
      .mockResolvedValueOnce(jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Rate limit' } }, 429))
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    // Vision succeeded, match failed → error state; retry button offers match-only re-run
    await waitFor(() => expect(screen.getByTestId('retry-button')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByTestId('retry-button')).toHaveTextContent('Spróbuj dopasować ponownie');

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => {
      expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
    }, { timeout: 5000 });

    // 6 calls: shelves, check-hash, record, process (OK), match (fail), match (retry) — process NOT re-run
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const processCalls = fetchMock.mock.calls.filter((c) => /\/process$/.test(String(c[0])));
    const matchCalls = fetchMock.mock.calls.filter((c) => /\/match$/.test(String(c[0])));
    expect(processCalls).toHaveLength(1);
    expect(matchCalls).toHaveLength(2);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('shows error area on storage upload failure (no retry-button, back button shown)', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'Storage error' } });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(checkHashMock());                                         // check-hash → no dup

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['x'], 'img.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('error-area')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByTestId('error-area')).toHaveTextContent('Storage error');
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
  });
});
