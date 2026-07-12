import { parseUuidParam } from '../http/response';

/**
 * Wyodrębnia shelf-id z pathname strony widoku konkretnej półki (`/shelves/<uuid>`).
 * Dopasowanie MUSI obejmować cały segment po `/shelves/` — `/shelves/<uuid>/cokolwiek`
 * (przyszła podścieżka) celowo NIE dopasowuje, żeby nie preselekcjonować półki
 * w kontekstach, które mogą jej nie dotyczyć.
 */
export function extractShelfIdFromPath(pathname: string): string | null {
  const match = /^\/shelves\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  return parseUuidParam(match[1]);
}
