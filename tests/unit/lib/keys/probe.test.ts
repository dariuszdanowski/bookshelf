import { describe, it, expect, vi, afterEach } from 'vitest';
import { listModels } from '../../../../src/lib/keys/probe';

function stubFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => vi.unstubAllGlobals());

describe('listModels', () => {
  it('zwraca listę z mieszaną dostępnością (available/is_available/status)', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'model-a', available: true },
              { id: 'model-b', available: false },
              { id: 'model-c', is_available: false },
              { id: 'model-d', status: 'offline' },
              { id: 'model-e', status: 'online' },
            ],
          }),
          { status: 200 },
        ),
    );

    const result = await listModels('openai_compatible', 'key', 'https://relay.example.com');

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([
      { id: 'model-a', available: true },
      { id: 'model-e', available: true },
      { id: 'model-b', available: false },
      { id: 'model-c', available: false },
      { id: 'model-d', available: false },
    ]);
  });

  it('domyślnie oznacza model jako dostępny, gdy brak pól dostępności', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'model-a', object: 'model' }] }), {
          status: 200,
        }),
    );

    const result = await listModels('openai_compatible', 'key', 'https://relay.example.com');

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([{ id: 'model-a', available: true }]);
  });

  it('obsługuje odpowiedź jako gołą tablicę (bez wrappera data)', async () => {
    stubFetch(async () => new Response(JSON.stringify([{ id: 'model-a' }]), { status: 200 }));

    const result = await listModels('openai_compatible', 'key', 'https://relay.example.com');

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([{ id: 'model-a', available: true }]);
  });

  it('zwraca ok:false na non-2xx', async () => {
    stubFetch(async () => new Response('forbidden', { status: 403 }));

    const result = await listModels('openai_compatible', 'key', 'https://relay.example.com');

    expect(result).toEqual({ ok: false, models: [] });
  });

  it('zwraca ok:false na network error', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });

    const result = await listModels('openai_compatible', 'key', 'https://relay.example.com');

    expect(result).toEqual({ ok: false, models: [] });
  });

  it('zwraca ok:false gdy brak base_url dla openai_compatible', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }));

    const result = await listModels('openai_compatible', 'key', null);

    expect(result).toEqual({ ok: false, models: [] });
  });

  it('filtruje wpisy bez poprawnego string id', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'ok-model' }, { notAnId: 1 }, null] }), {
          status: 200,
        }),
    );

    const result = await listModels('openai_compatible', 'key', 'https://relay.example.com');

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([{ id: 'ok-model', available: true }]);
  });
});
