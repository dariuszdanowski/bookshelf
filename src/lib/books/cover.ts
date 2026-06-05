// Podbicie rozdzielczości okładki do podglądu („wyraźna, nie ikonka").
//
// Okładki w katalogu/propozycjach są zapisane w rozmiarze M (~128-180px):
// - OpenLibrary: .../-M.jpg (warianty -S/-M/-L; -L ≈ 500px)
// - Google Books: ...&zoom=1&edge=curl (zoom=2 daje większy obraz; edge=curl
//   to efekt zagiętej kartki — zbędny w podglądzie)
// Dla nieznanych źródeł zwraca URL bez zmian.

import type { CoverSource } from './schema';

/**
 * Efektywna okładka wg flagi `cover_source` (S-33): 3 sloty mogą współistnieć,
 * flaga wybiera który pokazać. Gdy wybrany slot pusty — fallback do pierwszego
 * dostępnego (auto → url → photo), inaczej null (placeholder).
 */
export function effectiveCover(book: {
  cover_url: string | null;
  user_cover_url: string | null;
  cover_photo_url: string | null;
  cover_source: CoverSource;
}): string | null {
  const slot: Record<CoverSource, string | null> = {
    auto: book.cover_url,
    url: book.user_cover_url,
    photo: book.cover_photo_url,
  };
  return slot[book.cover_source] ?? book.cover_url ?? book.user_cover_url ?? book.cover_photo_url ?? null;
}

export function largeCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  // OpenLibrary: -S.jpg / -M.jpg → -L.jpg (zachowaj ewentualny ?default=false)
  if (url.includes('covers.openlibrary.org')) {
    return url.replace(/-(S|M)\.jpg/, '-L.jpg');
  }

  // Google Books content thumbnails: podbij zoom i zdejmij page-curl
  if (/books\.google|googleusercontent|books\.googleapis/.test(url)) {
    return url.replace(/([?&]zoom=)\d/, '$12').replace(/&edge=curl/, '');
  }

  return url;
}
