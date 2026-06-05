// Podbicie rozdzielczości okładki do podglądu („wyraźna, nie ikonka").
//
// Okładki w katalogu/propozycjach są zapisane w rozmiarze M (~128-180px):
// - OpenLibrary: .../-M.jpg (warianty -S/-M/-L; -L ≈ 500px)
// - Google Books: ...&zoom=1&edge=curl (zoom=2 daje większy obraz; edge=curl
//   to efekt zagiętej kartki — zbędny w podglądzie)
// Dla nieznanych źródeł zwraca URL bez zmian.

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
