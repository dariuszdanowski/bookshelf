import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { useApiKeys } from '../../../src/components/useApiKeys';
import type { ApiKeyDTO } from '../../../src/lib/keys/schema';

// Hook testujemy przez komponent-harness (wzorzec repo, zob.
// useDetectionViewMode.test.tsx — renderHook niedostępny w tej konfiguracji
// vitest+RTL+React19).
function Harness() {
  const { keys, error, fetchKeys } = useApiKeys();
  return (
    <div>
      <span data-testid="keys-count">{keys === null ? 'null' : keys.length}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <button data-testid="fetch-btn" onClick={fetchKeys}>
        fetch
      </button>
    </div>
  );
}

const SAMPLE_KEYS: ApiKeyDTO[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    label: 'glm-ocr',
    provider: 'openai_compatible',
    model: 'glm-ocr',
    base_url: 'https://relay.example.com',
    is_active: true,
    last_tested_at: null,
    last_test_result: 'ok',
    created_at: '2026-01-01T00:00:00Z',
    request_timeout_ms: null,
    max_tokens_override: 8192,
  },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApiKeys', () => {
  it('keys === null przed fetchKeys() — brak automatycznego fetcha na mount', () => {
    render(<Harness />);
    expect(screen.getByTestId('keys-count').textContent).toBe('null');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetchKeys() woła GET /api/account/keys i ustawia keys', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ data: { keys: SAMPLE_KEYS } }),
    } as Response);
    render(<Harness />);
    fireEvent.click(screen.getByTestId('fetch-btn'));
    expect(fetch).toHaveBeenCalledWith('/api/account/keys');
    await waitFor(() => expect(screen.getByTestId('keys-count').textContent).toBe('1'));
  });

  // impl-review F2: rozróżnienie data/error (mirror CostAnalysisModal) —
  // nie każda odpowiedź bez `data` jest cicho ignorowana.
  it('odpowiedź { error } — ustawia error state, keys zostaje null', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ error: { message: 'Brak sesji.' } }),
    } as Response);
    render(<Harness />);
    fireEvent.click(screen.getByTestId('fetch-btn'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('Brak sesji.'));
    expect(screen.getByTestId('keys-count').textContent).toBe('null');
  });

  it('błąd sieci — ustawia error state (nie blokuje renderu)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));
    render(<Harness />);
    fireEvent.click(screen.getByTestId('fetch-btn'));
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('Błąd sieci.'));
    expect(screen.getByTestId('keys-count').textContent).toBe('null');
  });

  // impl-review F3: race-guard — druga (późniejsza) fetchKeys() musi wygrać,
  // nawet jeśli jej odpowiedź wraca PRZED odpowiedzią pierwszej.
  it('szybkie podwójne fetchKeys() — wygrywa odpowiedź NAJNOWSZEGO wywołania', async () => {
    let resolveFirst!: (value: Response) => void;
    const firstPromise = new Promise<Response>((r) => {
      resolveFirst = r;
    });
    vi.mocked(fetch)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ data: { keys: SAMPLE_KEYS } }),
      } as Response);

    render(<Harness />);
    fireEvent.click(screen.getByTestId('fetch-btn')); // wywołanie #1 (wisi)
    fireEvent.click(screen.getByTestId('fetch-btn')); // wywołanie #2 (rozwiąże się jako pierwsze)

    await waitFor(() => expect(screen.getByTestId('keys-count').textContent).toBe('1'));

    // Teraz spóźniona odpowiedź #1 rozwiązuje się — NIE powinna nadpisać stanu.
    resolveFirst({
      json: () => Promise.resolve({ data: { keys: [] } }),
    } as Response);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByTestId('keys-count').textContent).toBe('1');
  });
});
