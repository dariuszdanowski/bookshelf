import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DetectionReview from '../../../src/components/DetectionReview';

const PHOTO_ID = '00000000-0000-4000-8000-000000000003';
const DET_ID_HIGH = '00000000-0000-4000-8000-000000000010';
const DET_ID_MID = '00000000-0000-4000-8000-000000000011';
const DET_ID_LOW = '00000000-0000-4000-8000-000000000012';
const DET_ID_NONE = '00000000-0000-4000-8000-000000000013';
const CAND_ID = '00000000-0000-4000-8000-000000000020';

function makePhoto(overrides = {}) {
  return {
    id: PHOTO_ID,
    shelf_id: '00000000-0000-4000-8000-000000000002',
    status: 'processed',
    detected_count: 3,
    error_message: null,
    vision_cost_usd: 0.005,
    vision_latency_ms: 4200,
    created_at: '2026-05-28T10:00:00Z',
    ...overrides,
  };
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: CAND_ID,
    source: 'google_books',
    externalId: 'gb-1',
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    isbn10: null,
    isbn13: '9780156027601',
    publisher: 'Harvest Books',
    publishedYear: 1987,
    coverUrl: null,
    matchScore: 0.9,
    rank: 1,
    ...overrides,
  };
}

function makeDetection(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    position_index: 1,
    raw_title: 'Solaris',
    raw_author: 'Stanisław Lem',
    vision_confidence: 0.95,
    spine_color: 'niebieski',
    bbox: null,
    status: 'matched',
    candidates: [],
    duplicate: null,
    ...overrides,
  };
}

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('DetectionReview', () => {
  it('shows loading skeletons initially', () => {
    mockFetch({ data: { photo: makePhoto(), detections: [] } });
    render(<DetectionReview photoId={PHOTO_ID} />);
    expect(screen.getByTestId('detection-review-loading')).toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    mockFetch({ error: { message: 'Not found.' } }, 404);
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('detection-review-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('detection-review-error')).toHaveTextContent('Not found.');
  });

  it('shows empty state when no detections', async () => {
    mockFetch({ data: { photo: makePhoto(), detections: [] } });
    render(<DetectionReview photoId={PHOTO_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('detection-review-empty')).toBeInTheDocument();
    });
  });

  it('renders detection cards after loading', async () => {
    const det = makeDetection(DET_ID_HIGH, {
      candidates: [makeCandidate({ matchScore: 0.9 })],
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('detection-review')).toBeInTheDocument();
    });
    expect(screen.getByTestId(`detection-card-1`)).toBeInTheDocument();
  });

  it('renders green tier badge for score >= 0.75', async () => {
    const det = makeDetection(DET_ID_HIGH, {
      candidates: [makeCandidate({ matchScore: 0.9 })],
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('tier-badge-high')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tier-badge-high')).toHaveTextContent('Wysoka pewność');
  });

  it('renders amber tier badge for score 0.55–0.75', async () => {
    const det = makeDetection(DET_ID_MID, {
      candidates: [makeCandidate({ matchScore: 0.65 })],
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('tier-badge-mid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tier-badge-mid')).toHaveTextContent('Sprawdź');
  });

  it('renders low tier badge for score < 0.55', async () => {
    const det = makeDetection(DET_ID_LOW, {
      candidates: [makeCandidate({ matchScore: 0.4 })],
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('tier-badge-low')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tier-badge-low')).toHaveTextContent('Niska pewność');
  });

  it('renders placeholder when no candidates', async () => {
    const det = makeDetection(DET_ID_NONE, { candidates: [] });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('no-match-placeholder')).toBeInTheDocument();
    });
    expect(screen.getByTestId('no-match-placeholder')).toHaveTextContent('Brak pewnego matchu');
  });

  it('renders exact duplicate flag', async () => {
    const det = makeDetection(DET_ID_HIGH, {
      candidates: [makeCandidate({ matchScore: 0.9 })],
      duplicate: { type: 'exact' },
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-flag')).toBeInTheDocument();
    });
    expect(screen.getByTestId('duplicate-flag')).toHaveTextContent('Masz już tę książkę w katalogu');
  });

  it('renders edition duplicate flag', async () => {
    const det = makeDetection(DET_ID_HIGH, {
      candidates: [makeCandidate({ matchScore: 0.9 })],
      duplicate: { type: 'edition' },
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-flag')).toBeInTheDocument();
    });
    expect(screen.getByTestId('duplicate-flag')).toHaveTextContent('Masz inną edycję tej książki');
  });

  it('does not render duplicate flag when duplicate is null', async () => {
    const det = makeDetection(DET_ID_HIGH, {
      candidates: [makeCandidate({ matchScore: 0.9 })],
      duplicate: null,
    });
    mockFetch({ data: { photo: makePhoto(), detections: [det] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('detection-review')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('duplicate-flag')).not.toBeInTheDocument();
  });

  it('calls correct API endpoint', async () => {
    const fetchSpy = mockFetch({ data: { photo: makePhoto(), detections: [] } });
    render(<DetectionReview photoId={PHOTO_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId('detection-review-empty')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith(`/api/photos/${PHOTO_ID}`);
  });
});
