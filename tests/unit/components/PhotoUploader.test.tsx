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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupCanvasMock() {
  const mockBlob = new Blob(['fake-image'], { type: 'image/jpeg' });
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const canvas = originalCreateElement('canvas') as HTMLCanvasElement;
      (canvas.getContext as unknown as (id: string) => unknown) = () => ({ drawImage: vi.fn() });
      canvas.toBlob = (cb: BlobCallback) => setTimeout(() => cb(mockBlob), 0);
      return canvas;
    }
    return originalCreateElement(tag);
  });
}

function setupImageMock() {
  Object.defineProperty(window, 'Image', {
    configurable: true,
    writable: true,
    value: class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 800;
      height = 600;
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  setupCanvasMock();
  setupImageMock();
  Object.defineProperty(global, 'crypto', {
    configurable: true,
    value: { randomUUID: () => MOCK_UUID },
  });
  mockUpload.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('happy path: upload→record→process sequence, detections rendered', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    // Progress appears
    await waitFor(() => expect(screen.getByTestId('progress-area')).toBeInTheDocument());

    // Results after processing
    await waitFor(() => expect(screen.getByTestId('results-area')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByTestId('detections-list')).toBeInTheDocument();
    expect(screen.getByTestId('detection-item-0')).toHaveTextContent('Solaris');

    // Sequence: shelves fetch, record POST, process POST
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/photos');
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/api\/photos\/.+\/process/);

    // Storage upload called with correct path
    expect(mockUpload).toHaveBeenCalledWith(
      `${USER_ID}/${MOCK_UUID}.jpg`,
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/jpeg' })
    );
  });

  it('retry button re-triggers process only (no re-upload)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Vision down' } }, 500))
      .mockResolvedValueOnce(jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('retry-button')).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(() => expect(screen.getByTestId('results-area')).toBeInTheDocument(), { timeout: 5000 });

    // 4th call = process retry (no extra storage upload)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][0]).toMatch(/\/api\/photos\/.+\/process/);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('shows error area on storage upload failure (no retry-button, back button shown)', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'Storage error' } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { shelves: mockShelves } })
    );

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['x'], 'img.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('error-area')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByTestId('error-area')).toHaveTextContent('Storage error');
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
  });
});
