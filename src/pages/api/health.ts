import type { APIRoute } from 'astro';

import { apiResponse } from '../../lib/http/response';
import pkg from '../../../package.json' with { type: 'json' };

export const prerender = false;

const PKG_VERSION: string = pkg.version;

/**
 * GET /api/health
 *
 * Public endpoint (whitelisted in `src/lib/middleware/handler.ts`
 * `PUBLIC_EXACT`) zwracający F-02 envelope `{data:{status,version,timestamp}}`.
 * Smoke target dla deploy verification (zob. lessons.md → „Worker Secret
 * validation"). Świadomie nie hituje Supabase — to liveness check, nie
 * readiness; głębsze check'i (DB ping) zostają na osobny slice gdy realnie
 * potrzebne.
 */
export const GET: APIRoute = () =>
  apiResponse({
    data: {
      status: 'ok' as const,
      version: PKG_VERSION,
      timestamp: new Date().toISOString(),
    },
  });
