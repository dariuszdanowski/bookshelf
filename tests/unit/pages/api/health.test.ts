import { describe, expect, it } from 'vitest';

import { GET } from '../../../../src/pages/api/health';

describe('GET /api/health', () => {
  it('returns 200 + F-02 envelope with status, version, timestamp + Cache-Control header', async () => {
    const res = await GET({} as never);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const json = (await res.json()) as {
      data: { status: string; version: string; timestamp: string };
    };
    expect(json.data.status).toBe('ok');
    expect(typeof json.data.version).toBe('string');
    expect(json.data.version.length).toBeGreaterThan(0);
    expect(typeof json.data.timestamp).toBe('string');
  });

  it('returns timestamp as a valid ISO 8601 string', async () => {
    const res = await GET({} as never);
    const json = (await res.json()) as { data: { timestamp: string } };

    const parsed = new Date(json.data.timestamp);
    expect(parsed.toString()).not.toBe('Invalid Date');
    // Round-trip check: re-serializacja musi zwrócić ten sam string (właściwość
    // canonicznego ISO string z `Date.prototype.toISOString()`).
    expect(parsed.toISOString()).toBe(json.data.timestamp);
  });
});
