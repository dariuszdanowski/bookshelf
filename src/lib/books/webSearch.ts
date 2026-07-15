/**
 * Buduje URL wyszukiwania Google z podanych fragmentów (tytuł, autor, ISBN...).
 * Single source of truth dla „Szukaj w sieci" — reużywane przez WebSearchButton
 * (DetectionActionsRow.tsx, DetectionCard) i BookModal (unify-detection-edit-entrypoint,
 * Faza 5 — wcześniej dwie niezależne implementacje).
 *
 * Zwraca null gdy wszystkie fragmenty są puste (nic do wyszukania) — wołający
 * decyduje wtedy, czy w ogóle renderować link.
 */
export function buildGoogleSearchUrl(parts: Array<string | null | undefined>): string | null {
  const q = parts
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(' ')
    .trim();
  return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : null;
}
