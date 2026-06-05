/**
 * Single source of truth dla kontraktu odpowiedzi API.
 *
 * Endpointy w `src/pages/api/**` konsumują wyłącznie `apiResponse` / `apiError`
 * — NIGDY nie konstruują `new Response()` ręcznie. Powód: konwergencja na
 * konwencję envelope + security headers (Cache-Control: private, no-store) +
 * 404-privacy z PRD wymaga enforcement-by-code, bo proza w CLAUDE.md zacisnęła
 * 1/5 dywergencji w teście N=3 (lessons.md, 2026-05-20).
 */

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'DUPLICATE_PHOTO'
  | 'AI_DISABLED'
  | 'NO_API_KEY';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  // Cache-Control: private, no-store — Cloudflare edge cache nie może
  // shared-cache'ować JWT-scoped contentu (PRD guardrail prywatności).
  'Cache-Control': 'private, no-store',
} as const;

export function apiResponse<T>(opts: {
  data: T;
  status?: number;
  headers?: HeadersInit;
}): Response {
  return buildResponse({ data: opts.data }, opts.status ?? 200, opts.headers);
}

export function apiError(opts: {
  code: ApiErrorCode;
  status: number;
  message: string;
  details?: unknown;
  headers?: HeadersInit;
}): Response {
  // `details` pomijamy w body gdy nie podany — różni się od `null`, klient
  // nie powinien dostawać pustego pola.
  const errorBody: { code: ApiErrorCode; message: string; details?: unknown } = {
    code: opts.code,
    message: opts.message,
  };
  if (opts.details !== undefined) {
    errorBody.details = opts.details;
  }

  return buildResponse({ error: errorBody }, opts.status, opts.headers);
}

// UUID v1-v5 regex (case-insensitive). Nie wymuszamy konkretnej wersji —
// Postgres `gen_random_uuid()` zwraca v4, ale walidator powinien też przyjąć
// inne wersje na wypadek importu z zewnętrznych źródeł w przyszłości.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Waliduje param ścieżki jako UUID. Zwraca lowercase string albo `null`.
 * Call-site mapuje null → `apiError({ code: 'NOT_FOUND', status: 404 })`
 * (privacy-first: nie wyciekamy kształtu ID nieuwierzytelnionym).
 */
export function parseUuidParam(raw: string | undefined): string | null {
  if (!raw || !UUID_REGEX.test(raw)) return null;
  return raw.toLowerCase();
}

/**
 * Pre-serialized fallback envelope dla `buildResponse` gdy `JSON.stringify`
 * na user-supplied body padnie (circular ref, BigInt itp.). Module-level
 * constant = jeden stringify execution na cały lifetime modułu; static shape
 * gwarantuje że ten stringify nie może paść.
 */
const FALLBACK_BODY = JSON.stringify({
  error: {
    code: 'INTERNAL_ERROR' satisfies ApiErrorCode,
    message: 'Response serialization failed.',
  },
});

function buildResponse(
  body: unknown,
  status: number,
  headers?: HeadersInit
): Response {
  let bodyString: string;
  let actualStatus = status;
  try {
    bodyString = JSON.stringify(body);
  } catch (err) {
    // Defensive fallback: chronimy envelope contract przed circular refs /
    // BigInt / innymi non-serializable values w body. W praktyce M1 endpointy
    // pasują plain serializable obj — to safety net na worst case.
    console.error('[response] JSON.stringify failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    bodyString = FALLBACK_BODY;
    actualStatus = 500;
  }
  return new Response(bodyString, {
    status: actualStatus,
    headers: mergeHeaders(headers),
  });
}

function mergeHeaders(custom?: HeadersInit): HeadersInit {
  if (!custom) return { ...DEFAULT_HEADERS };
  // Custom headers nadpisują defaultowe przy kolizji klucza. Używamy `Headers`
  // class żeby case-insensitive merge zadziałał poprawnie (`content-type` ===
  // `Content-Type`).
  const merged = new Headers(DEFAULT_HEADERS);
  new Headers(custom).forEach((value, key) => merged.set(key, value));
  return merged;
}
