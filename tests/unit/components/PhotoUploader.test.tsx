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
    id: SHELF_ID,
    name: 'Salon',
    location: null,
    position_index: 0,
    is_system: false,
    book_count: 0,
    created_at: '2026-01-01T00:00:00Z',
  },
];
const mockPhoto = {
  id: PHOTO_ID,
  shelf_id: SHELF_ID,
  status: 'processed',
  detected_count: 1,
  error_message: null,
  vision_cost_usd: 0.005,
  vision_latency_ms: 5000,
  created_at: '2026-01-01T00:00:00Z',
};
const mockDetections = [
  {
    position_index: 1,
    raw_title: 'Solaris',
    raw_author: 'Stanisław Lem',
    vision_confidence: 0.95,
    spine_color: 'niebieski',
  },
];
const mockMatchResult = { data: { matched: 1, detections: [] } };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Key check fires first on mount (before shelves). Tests mock it with an active key
// unless the test specifically exercises the no-key warning path.
function activeKeyMock() {
  return jsonResponse({ data: { keys: [{ is_active: true }] } });
}

const originalLocation = window.location;

const NO_DUPLICATE_RESPONSE = { data: { photo: null } };

function checkHashMock() {
  return jsonResponse(NO_DUPLICATE_RESPONSE);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
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
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })); // shelves
    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
  });

  it('shows no-key warning banner (non-blocking) when no active key', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: { keys: [] } })) // keys: none
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })); // shelves
    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('photo-uploader-no-key-warning')).toBeInTheDocument(),
    );
    // Warning is non-blocking — drop zone and shelf select still visible
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    expect(screen.getByTestId('shelf-select')).toBeInTheDocument();
  });

  it('happy path: upload→record→process→match→redirect to review page', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(checkHashMock()) // check-hash → no dup
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }),
      )
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(
      () => {
        expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
      },
      { timeout: 5000 },
    );

    // Sequence: keys, shelves, check-hash, record POST, process POST, match POST
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[3][0]).toBe('/api/photos');
    expect(fetchMock.mock.calls[4][0]).toMatch(/\/api\/photos\/.+\/process/);
    expect(fetchMock.mock.calls[5][0]).toMatch(/\/api\/photos\/.+\/match/);

    expect(mockUpload).toHaveBeenCalledWith(
      `${USER_ID}/${MOCK_UUID}.jpg`,
      expect.any(File),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
  });

  it('retry button re-triggers process+match (no re-upload)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(checkHashMock()) // check-hash → no dup
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Vision down' } }, 500),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }),
      )
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('retry-button')).toBeInTheDocument(), {
      timeout: 5000,
    });

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(
      () => {
        expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
      },
      { timeout: 5000 },
    );

    // 7 calls: keys, shelves, check-hash, record, process (fail), process (retry), match (retry)
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls[5][0]).toMatch(/\/api\/photos\/.+\/process/);
    expect(fetchMock.mock.calls[6][0]).toMatch(/\/api\/photos\/.+\/match/);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('match-only retry: vision succeeded but match failed → retry re-runs match only (no re-process)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(checkHashMock()) // check-hash → no dup
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Rate limit' } }, 429),
      )
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('retry-button')).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getByTestId('retry-button')).toHaveTextContent('Spróbuj dopasować ponownie');

    fireEvent.click(screen.getByTestId('retry-button'));

    await waitFor(
      () => {
        expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
      },
      { timeout: 5000 },
    );

    // 7 calls: keys, shelves, check-hash, record, process (OK), match (fail), match (retry)
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const processCalls = fetchMock.mock.calls.filter((c) => /\/process$/.test(String(c[0])));
    const matchCalls = fetchMock.mock.calls.filter((c) => /\/match$/.test(String(c[0])));
    expect(processCalls).toHaveLength(1);
    expect(matchCalls).toHaveLength(2);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('process 403 NO_API_KEY — shows error with link to /account', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(checkHashMock()) // check-hash → no dup
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'NO_API_KEY', message: 'Brak klucza API' } }, 403),
      );

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('error-area')).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getByTestId('no-api-key-link')).toBeInTheDocument();
    expect(screen.getByTestId('no-api-key-link')).toHaveAttribute('href', '/account');
  });

  it('happy path: sessionStorage cleared after successful redirect (recovery path)', async () => {
    const STALE_ID = '00000000-0000-4000-8000-aaaaaaaaaaaa';
    sessionStorage.setItem('upload_resume_photo_id', STALE_ID);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { id: STALE_ID, status: 'processing' }, detections: [] } }),
      ) // recovery GET
      .mockResolvedValueOnce(
        jsonResponse({
          data: { photo: { ...mockPhoto, id: STALE_ID }, detections: mockDetections },
        }),
      ) // process POST
      .mockResolvedValueOnce(jsonResponse(mockMatchResult)); // match POST

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(window.location.href).toBe(`/photos/${STALE_ID}`), {
      timeout: 5000,
    });
    expect(sessionStorage.getItem('upload_resume_photo_id')).toBeNull();
  });

  it('shows error area on storage upload failure (no retry-button, back button shown)', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'Storage error' } });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(checkHashMock()); // check-hash → no dup

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());

    await triggerFileUpload(new File(['x'], 'img.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(screen.getByTestId('error-area')).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getByTestId('error-area')).toHaveTextContent('Storage error');
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
  });
});

describe('PhotoUploader — reload recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => '11111111-1111-4111-8111-111111111111',
        subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) },
      },
    });
    mockUpload.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('status=processing — wznawiamy process+match i redirectujemy', async () => {
    sessionStorage.setItem('upload_resume_photo_id', PHOTO_ID);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: [] } })) // shelves
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { id: PHOTO_ID, status: 'processing' }, detections: [] } }),
      ) // recovery GET
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }),
      ) // process POST
      .mockResolvedValueOnce(jsonResponse(mockMatchResult)); // match POST

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(window.location.href).toBe(`/photos/${PHOTO_ID}`), {
      timeout: 5000,
    });
    expect(sessionStorage.getItem('upload_resume_photo_id')).toBeNull();
  });

  it('status=failed — pokazuje error area, czyści sessionStorage', async () => {
    sessionStorage.setItem('upload_resume_photo_id', PHOTO_ID);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: [] } })) // shelves
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { id: PHOTO_ID, status: 'failed' }, detections: [] } }),
      );

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('error-area')).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getByTestId('error-area')).toHaveTextContent('Poprzednie przetwarzanie');
    expect(sessionStorage.getItem('upload_resume_photo_id')).toBeNull();
  });

  it('status=processed z pending detekcjami — wznawiamy tylko match', async () => {
    sessionStorage.setItem('upload_resume_photo_id', PHOTO_ID);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: [] } })) // shelves
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            photo: { id: PHOTO_ID, status: 'processed' },
            detections: [{ status: 'pending' }],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(window.location.href).toBe(`/photos/${PHOTO_ID}`), {
      timeout: 5000,
    });
  });

  it('status=processed bez pending detekcji — redirect bez dodatkowych callów', async () => {
    sessionStorage.setItem('upload_resume_photo_id', PHOTO_ID);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: [] } })) // shelves
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            photo: { id: PHOTO_ID, status: 'processed' },
            detections: [{ status: 'matched' }],
          },
        }),
      );

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(window.location.href).toBe(`/photos/${PHOTO_ID}`), {
      timeout: 5000,
    });
    expect(sessionStorage.getItem('upload_resume_photo_id')).toBeNull();
  });

  it('brak sessionStorage — normalne idle, brak dodatkowych fetch callów', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys check
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: [] } })); // shelves

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('drop-zone')).toBeInTheDocument());
    // 2 fetch calls (keys + shelves), no recovery fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// S-36: checkbox „Analizuj od razu" — upload bez vision/match
// ---------------------------------------------------------------------------

describe('PhotoUploader — skip process (S-36)', () => {
  beforeEach(() => {
    window.localStorage.removeItem('bookshelf:upload-auto-process');
  });
  afterEach(() => {
    window.localStorage.removeItem('bookshelf:upload-auto-process');
  });

  it('checkbox domyślnie zaznaczony', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock())
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }));
    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('auto-process-checkbox')).toBeInTheDocument());
    expect(screen.getByTestId('auto-process-checkbox')).toBeChecked();
  });

  it('odznaczony → upload BEZ /process i /match, redirect na ?tab=photos, bez resume-state', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock()) // keys
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } })) // shelves
      .mockResolvedValueOnce(checkHashMock()) // check-hash
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201),
      ); // record

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('auto-process-checkbox')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('auto-process-checkbox')); // odznacz
    expect(window.localStorage.getItem('bookshelf:upload-auto-process')).toBe('false');

    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(
      () => {
        expect(window.location.href).toBe(`/shelves/${SHELF_ID}?tab=photos`);
      },
      { timeout: 5000 },
    );

    // ZERO wywołań vision/match — twardy guardrail kosztowy
    const calledUrls = fetchMock.mock.calls.map(([u]) => (typeof u === 'string' ? u : ''));
    expect(calledUrls.some((u) => u.includes('/process'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('/match'))).toBe(false);
    // Pitfall z roadmapy: bez resume-state przy skip
    expect(sessionStorage.getItem('upload_resume_photo_id')).toBeNull();
  });

  it('preferencja false czytana z localStorage przy mount', async () => {
    window.localStorage.setItem('bookshelf:upload-auto-process', 'false');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock())
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }));
    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('auto-process-checkbox')).not.toBeChecked());
  });

  it('zaznaczony (default) → obecny flow z /process i /match (regresja)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(activeKeyMock())
      .mockResolvedValueOnce(jsonResponse({ data: { shelves: mockShelves } }))
      .mockResolvedValueOnce(checkHashMock())
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: { ...mockPhoto, status: 'uploaded' } } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { photo: mockPhoto, detections: mockDetections } }),
      )
      .mockResolvedValueOnce(jsonResponse(mockMatchResult));

    render(<PhotoUploader userId={USER_ID} />);
    await waitFor(() => expect(screen.getByTestId('shelf-select')).toBeInTheDocument());
    await triggerFileUpload(new File(['fake'], 'shelf.jpg', { type: 'image/jpeg' }));

    await waitFor(
      () => {
        expect(window.location.href).toBe(`/photos/${PHOTO_ID}`);
      },
      { timeout: 5000 },
    );
    const calledUrls = fetchMock.mock.calls.map(([u]) => (typeof u === 'string' ? u : ''));
    expect(calledUrls.some((u) => u.includes('/process'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/match'))).toBe(true);
  });
});
