import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted ensures mockCreate is initialized before vi.mock factory runs (ESM hoisting)
const mockCreate = vi.hoisted(() => vi.fn());
const mockFindBookCandidates = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

vi.mock('../../../../src/lib/matching/findCandidates', () => ({
  findBookCandidates: mockFindBookCandidates,
}));

import { resolveBookViaAI } from '../../../../src/lib/resolution/client';

const config = { apiKey: 'sk-test' };
const query = { rawTitle: 'Zlodziej ksiazek', rawAuthor: null };

function makeResponse(
  textContent: string,
  opts: { inputTokens?: number; outputTokens?: number; webSearchRequests?: number } = {},
) {
  return {
    content: [{ type: 'text', text: textContent }],
    model: 'claude-sonnet-4-6',
    usage: {
      input_tokens: opts.inputTokens ?? 1000,
      output_tokens: opts.outputTokens ?? 100,
      server_tool_use: { web_search_requests: opts.webSearchRequests ?? 1 },
    },
  };
}

function makeScoredCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source: 'google_books',
    externalId: 'gb-1',
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    isbn10: null,
    isbn13: '9788308034609',
    publisher: 'Wydawnictwo Literackie',
    publishedYear: 1961,
    coverUrl: 'https://example.com/cover.jpg',
    description: 'Opis książki',
    matchScore: 0.9,
    ...overrides,
  };
}

function makeToolCall(id: string, args: Record<string, unknown>) {
  return {
    id,
    type: 'function',
    function: { name: 'search_book', arguments: JSON.stringify(args) },
  };
}

function makeToolCallResponse(toolCalls: ReturnType<typeof makeToolCall>[]) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: null, tool_calls: toolCalls } }] }),
  };
}

function makeFinalResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

function makeHttpErrorResponse(status: number, body = '') {
  return { ok: false, status, text: async () => body };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('resolveBookViaAI', () => {
  it('parsuje czysty JSON found', async () => {
    const json = JSON.stringify({
      status: 'found',
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: 1961,
      confidence: 0.9,
    });
    mockCreate.mockResolvedValueOnce(makeResponse(json));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('found');
    if (outcome.result.status === 'found') {
      expect(outcome.result.title).toBe('Solaris');
    }
    expect(outcome.model).toBe('claude-sonnet-4-6');
    expect(outcome.searchCount).toBe(1);
  });

  // Regresja manualnego smoke testu (2026-07-13): web_search tool dołącza
  // narracyjne zdanie PRZED JSON-em mimo instrukcji "TYLKO JSON" — parser
  // musi wyciągnąć ostatni blok {...}, nie zakładać że cały tekst to JSON.
  it('wyciąga JSON gdy model dołącza zdanie wstępne przed blokiem JSON', async () => {
    const json = JSON.stringify({
      status: 'found',
      title: 'Siewcy koszmarów',
      authors: ['Martyna Raduchowska'],
      isbn10: null,
      isbn13: '9788368608465',
      publisher: 'Wydawnictwo Mięta',
      publishedYear: 2026,
      confidence: 0.91,
    });
    const text = `OCR odczytało błędnie tytuł i autora — prawdopodobnie chodzi o poniższą książkę.${json}`;
    mockCreate.mockResolvedValueOnce(makeResponse(text));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('found');
    if (outcome.result.status === 'found') {
      expect(outcome.result.title).toBe('Siewcy koszmarów');
      expect(outcome.result.authors).toEqual(['Martyna Raduchowska']);
    }
  });

  it('parsuje JSON owinięty w code fence markdown', async () => {
    const json = JSON.stringify({ status: 'not_found', reason: 'Brak trafienia' });
    mockCreate.mockResolvedValueOnce(makeResponse('```json\n' + json + '\n```'));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('not_found');
  });

  // Regresja manualnego smoke testu (2026-07-15): self-hosted model zwrócił odpowiedź
  // z wiodącym "\n" przed fence — `^` anchor w stripCodeFences nie dopasowywał się.
  it('parsuje JSON owinięty w code fence markdown poprzedzony wiodącym whitespace', async () => {
    const json = JSON.stringify({ status: 'not_found', reason: 'Brak trafienia' });
    mockCreate.mockResolvedValueOnce(makeResponse('\n```json\n' + json + '\n```'));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('not_found');
  });

  it('zwraca parse_failure gdy w tekście nie ma żadnego JSON', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('Nie udało mi się znaleźć tej książki.'));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('parse_failure');
  });

  it('zwraca parse_failure gdy JSON nie przechodzi walidacji schematu', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse(JSON.stringify({ status: 'found' })));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('parse_failure');
  });

  it('zwraca api_error gdy SDK rzuca wyjątek', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limited'));

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('api_error');
    expect(outcome.errorMessage).toContain('rate limited');
  });

  it('liczy koszt: tokeny + $0.01 per web search wykonany', async () => {
    const json = JSON.stringify({ status: 'not_found', reason: null });
    mockCreate.mockResolvedValueOnce(
      makeResponse(json, { inputTokens: 100_000, outputTokens: 1_000, webSearchRequests: 2 }),
    );

    const outcome = await resolveBookViaAI(query, config);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 100000/1M*$3 + 1000/1M*$15 + 2*$0.01 = 0.3 + 0.015 + 0.02 = 0.335
    expect(outcome.costUsd).toBeCloseTo(0.335, 6);
    expect(outcome.searchCount).toBe(2);
  });

  it('wysyła web_search tool i prompt użytkownika z tytułem/autorem/wydawnictwem', async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(JSON.stringify({ status: 'not_found', reason: null })),
    );

    await resolveBookViaAI(
      { rawTitle: 'Solaris', rawAuthor: 'Stanisław Lem', publisher: 'Wydawnictwo Literackie' },
      config,
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    expect(call.messages[0].content).toContain('Solaris');
    expect(call.messages[0].content).toContain('Stanisław Lem');
    expect(call.messages[0].content).toContain('Wydawnictwo Literackie');
  });

  it('brak provider w configu → fallback na anthropic (regresja istniejącego zachowania)', async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse(JSON.stringify({ status: 'not_found', reason: null })),
    );

    const outcome = await resolveBookViaAI(query, { apiKey: 'sk-test' });

    expect(outcome.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBookViaAI — openai_compatible branch', () => {
  const openaiCompatConfig = {
    provider: 'openai_compatible' as const,
    apiKey: 'sk-test',
    baseUrl: 'https://relay.example.com',
  };

  it('happy path: zwraca found, costUsd=0, searchCount=0', async () => {
    const validJson = JSON.stringify({
      status: 'found',
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: 1961,
      confidence: 0.9,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: validJson } }] }),
      }),
    );

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('found');
    expect(outcome.costUsd).toBe(0);
    expect(outcome.searchCount).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('zwraca parse_failure gdy odpowiedź nie jest poprawnym JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not valid json' } }] }),
      }),
    );

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('parse_failure');

    vi.unstubAllGlobals();
  });

  it('zwraca api_error gdy HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' }),
    );

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('api_error');

    vi.unstubAllGlobals();
  });

  it('zwraca api_error gdy fetch odrzuca (timeout/AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(abortError));

    const outcome = await resolveBookViaAI(query, { ...openaiCompatConfig, requestTimeoutMs: 100 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('api_error');

    vi.unstubAllGlobals();
  });

  it('używa custom baseUrl i maxTokensOverride z configu', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ status: 'not_found', reason: null }) } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await resolveBookViaAI(query, { ...openaiCompatConfig, maxTokensOverride: 5000 });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://relay.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(5000);
    // Pierwszy request zawsze zawiera search_book tool (chyba że wcześniejszy request
    // w tym samym wywołaniu dostał HTTP 400 i wywołał fallback — zob. testy fallbacku niżej).
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('search_book');

    vi.unstubAllGlobals();
  });

  it('wyciąga ostatni blok JSON gdy model dołącza tekst przed odpowiedzią', async () => {
    const json = JSON.stringify({ status: 'not_found', reason: 'brak pewności' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: `Oto co znalazłem.${json}` } }],
        }),
      }),
    );

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('not_found');

    vi.unstubAllGlobals();
  });

  it('1 runda: tool_calls → search_book → finalna odpowiedź found', async () => {
    mockFindBookCandidates.mockResolvedValueOnce({
      candidates: [makeScoredCandidate()],
      rateLimited: false,
    });
    const finalJson = JSON.stringify({
      status: 'found',
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn10: null,
      isbn13: '9788308034609',
      publisher: 'Wydawnictwo Literackie',
      publishedYear: 1961,
      confidence: 0.9,
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([
          makeToolCall('call_1', { title: 'Solaris', author: 'Stanisław Lem' }),
        ]),
      )
      .mockResolvedValueOnce(makeFinalResponse(finalJson));
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('found');
    expect(outcome.searchCount).toBe(1);
    expect(mockFindBookCandidates).toHaveBeenCalledWith('Solaris', 'Stanisław Lem', null);

    // Format wyniku narzędzia przekazywany modelowi: okrojone pola ScoredCandidate,
    // BEZ coverUrl/description (zob. plan § Faza 1, Kontrakt).
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMessage = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content).candidates[0]).toEqual({
      title: 'Solaris',
      authors: ['Stanisław Lem'],
      isbn10: null,
      isbn13: '9788308034609',
      publisher: 'Wydawnictwo Literackie',
      publishedYear: 1961,
      matchScore: 0.9,
    });

    vi.unstubAllGlobals();
  });

  it('multi-round (2 rundy) → searchCount odpowiada liczbie wywołań findBookCandidates, nie requestów HTTP', async () => {
    mockFindBookCandidates
      .mockResolvedValueOnce({
        candidates: [makeScoredCandidate({ title: 'Zlodziej ksiazek' })],
        rateLimited: false,
      })
      .mockResolvedValueOnce({
        candidates: [makeScoredCandidate({ title: 'Złodziejka książek' })],
        rateLimited: false,
      });
    const finalJson = JSON.stringify({
      status: 'found',
      title: 'Złodziejka książek',
      authors: ['Markus Zusak'],
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      confidence: 0.85,
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([makeToolCall('call_1', { title: 'Zlodziej ksiazek' })]),
      )
      .mockResolvedValueOnce(
        makeToolCallResponse([makeToolCall('call_2', { title: 'Złodziejka książek' })]),
      )
      .mockResolvedValueOnce(makeFinalResponse(finalJson));
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.status).toBe('found');
    expect(outcome.searchCount).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFindBookCandidates).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('przekroczenie MAX_TOOL_ROUNDS: finalny request bez tools', async () => {
    mockFindBookCandidates
      .mockResolvedValueOnce({ candidates: [makeScoredCandidate()], rateLimited: false })
      .mockResolvedValueOnce({ candidates: [makeScoredCandidate()], rateLimited: false })
      .mockResolvedValueOnce({ candidates: [makeScoredCandidate()], rateLimited: false });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeToolCallResponse([makeToolCall('call_1', { title: 'Solaris' })]))
      .mockResolvedValueOnce(makeToolCallResponse([makeToolCall('call_2', { title: 'Solaris' })]))
      .mockResolvedValueOnce(makeToolCallResponse([makeToolCall('call_3', { title: 'Solaris' })]))
      .mockResolvedValueOnce(
        makeFinalResponse(JSON.stringify({ status: 'not_found', reason: null })),
      );
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const lastBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(lastBody.tools).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('fallback: HTTP 400 na pierwszym requeście → retry bez tools, sukces na drugiej próbie', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeHttpErrorResponse(400, 'Unknown parameter: tools'))
      .mockResolvedValueOnce(
        makeFinalResponse(JSON.stringify({ status: 'not_found', reason: null })),
      );
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.tools).toBeUndefined();
    expect(secondBody.messages[0].content).not.toContain('search_book');

    vi.unstubAllGlobals();
  });

  it('HTTP 400 w trakcie pętli (po udanej rundzie z tools) → api_error, NIE fallback', async () => {
    mockFindBookCandidates.mockResolvedValueOnce({
      candidates: [makeScoredCandidate()],
      rateLimited: false,
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeToolCallResponse([makeToolCall('call_1', { title: 'Solaris' })]))
      .mockResolvedValueOnce(makeHttpErrorResponse(400, 'bad request'));
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('api_error');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('równoległe tool_calls (2 elementy) → 2 wiadomości tool w tej samej kolejności', async () => {
    mockFindBookCandidates
      .mockResolvedValueOnce({
        candidates: [makeScoredCandidate({ title: 'Solaris' })],
        rateLimited: false,
      })
      .mockResolvedValueOnce({
        candidates: [makeScoredCandidate({ title: 'Eden' })],
        rateLimited: false,
      });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([
          makeToolCall('call_a', { title: 'Solaris' }),
          makeToolCall('call_b', { title: 'Eden' }),
        ]),
      )
      .mockResolvedValueOnce(
        makeFinalResponse(JSON.stringify({ status: 'not_found', reason: null })),
      );
    vi.stubGlobal('fetch', mockFetch);

    await resolveBookViaAI(query, openaiCompatConfig);

    expect(mockFindBookCandidates).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMessages = secondBody.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0].tool_call_id).toBe('call_a');
    expect(toolMessages[1].tool_call_id).toBe('call_b');

    vi.unstubAllGlobals();
  });

  it('przekroczenie MAX_PARALLEL_TOOL_CALLS (4 równoległe) → nadmiarowe dostają błąd, findBookCandidates wołane max 3 razy', async () => {
    mockFindBookCandidates
      .mockResolvedValueOnce({ candidates: [makeScoredCandidate()], rateLimited: false })
      .mockResolvedValueOnce({ candidates: [makeScoredCandidate()], rateLimited: false })
      .mockResolvedValueOnce({ candidates: [makeScoredCandidate()], rateLimited: false });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([
          makeToolCall('call_1', { title: 'A' }),
          makeToolCall('call_2', { title: 'B' }),
          makeToolCall('call_3', { title: 'C' }),
          makeToolCall('call_4', { title: 'D' }),
        ]),
      )
      .mockResolvedValueOnce(
        makeFinalResponse(JSON.stringify({ status: 'not_found', reason: null })),
      );
    vi.stubGlobal('fetch', mockFetch);

    await resolveBookViaAI(query, openaiCompatConfig);

    expect(mockFindBookCandidates).toHaveBeenCalledTimes(3);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMessages = secondBody.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMessages).toHaveLength(4);
    expect(JSON.parse(toolMessages[3].content).error).toContain('too many parallel tool calls');

    vi.unstubAllGlobals();
  });

  it('błędne argumenty tool-call (JSON invalid / Zod fail) → wiadomość tool z błędem, pętla kontynuuje', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([
          {
            id: 'call_bad_json',
            type: 'function',
            function: { name: 'search_book', arguments: 'not valid json' },
          },
          makeToolCall('call_bad_schema', { title: '' }),
        ]),
      )
      .mockResolvedValueOnce(
        makeFinalResponse(JSON.stringify({ status: 'not_found', reason: null })),
      );
    vi.stubGlobal('fetch', mockFetch);

    const outcome = await resolveBookViaAI(query, openaiCompatConfig);

    expect(outcome.ok).toBe(true);
    expect(mockFindBookCandidates).not.toHaveBeenCalled();
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMessages = secondBody.messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(JSON.parse(toolMessages[0].content).error).toBe('invalid arguments');
    expect(JSON.parse(toolMessages[1].content).error).toBe('invalid arguments');

    vi.unstubAllGlobals();
  });

  it('rateLimited z findBookCandidates jest przekazywane modelowi gdy brak kandydatów', async () => {
    mockFindBookCandidates.mockResolvedValueOnce({ candidates: [], rateLimited: true });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([makeToolCall('call_1', { title: 'Rzadki tytuł' })]),
      )
      .mockResolvedValueOnce(
        makeFinalResponse(JSON.stringify({ status: 'not_found', reason: 'rate limited' })),
      );
    vi.stubGlobal('fetch', mockFetch);

    await resolveBookViaAI(query, openaiCompatConfig);

    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMessage = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content)).toEqual({ candidates: [], rateLimited: true });

    vi.unstubAllGlobals();
  });
});
