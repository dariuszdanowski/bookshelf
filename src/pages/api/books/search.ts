import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiError, apiResponse } from '../../../lib/http/response';
import {
  SearchBooksQuerySchema,
  type CatalogBookDTO,
  type CoverSource,
} from '../../../lib/books/schema';

export const prerender = false;

/**
 * GET /api/books/search
 *
 * Wyszukiwarka katalogu (S-08). Pełnotekst (ILIKE na search_text: tytuł+autorzy+
 * wydawnictwo) + filtry kombinowalne: kolor grzbietu, półka (multi-select),
 * status przeczytania. Wyniki = książka + nazwa półki + pozycja + kolor.
 *
 * Dwa zapytania (zamiast kruchego embedded-filter): (1) aktualne wpisy półkowe
 * usera (book_id → shelf+pozycja), (2) books filtrowane przez .in(book_ids) +
 * search/color/read. RLS scope-uje oba do usera. ~1000/user → p95<1s.
 *
 * Query params: q, color, shelf (powtarzalne), read (read|unread|all).
 * 200: { data: { books: CatalogBookDTO[], total } }
 * 400: walidacja
 */
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.user) {
    return apiError({ code: 'UNAUTHENTICATED', status: 401, message: 'Authentication required.' });
  }

  // Parse query params (shelf powtarzalny → getAll)
  const sp = url.searchParams;
  const rawColor = sp.get('color') ?? undefined;
  const rawRead = sp.get('read') ?? undefined;
  const shelfIds = sp.getAll('shelf').filter(Boolean);
  const parsed = SearchBooksQuerySchema.safeParse({
    q: sp.get('q') ?? undefined,
    color: rawColor,
    shelf_ids: shelfIds.length > 0 ? shelfIds : undefined,
    read: rawRead,
    purchase_event: sp.get('purchase_event') ?? undefined,
    purchase_city: sp.get('purchase_city') ?? undefined,
    purchase_date_from: sp.get('purchase_date_from') ?? undefined,
    purchase_date_to: sp.get('purchase_date_to') ?? undefined,
    purchase_price_min: sp.get('purchase_price_min') ?? undefined,
    purchase_price_max: sp.get('purchase_price_max') ?? undefined,
  });
  if (!parsed.success) {
    return apiError({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Nieprawidłowe parametry wyszukiwania.',
      details: z.flattenError(parsed.error),
    });
  }
  const {
    q,
    color,
    shelf_ids,
    read,
    purchase_event,
    purchase_city,
    purchase_date_from,
    purchase_date_to,
    purchase_price_min,
    purchase_price_max,
  } = parsed.data;

  // 1. Aktualne wpisy półkowe (RLS-scoped przez book ownership); opcjonalny filtr półek
  let entriesQuery = locals.supabase
    .from('shelf_entries')
    .select('book_id, shelf_id, position_index, photo_id, detection_id, shelves(id, name)')
    .eq('is_current', true);
  if (shelf_ids && shelf_ids.length > 0) {
    entriesQuery = entriesQuery.in('shelf_id', shelf_ids);
  }
  const { data: entries, error: entriesError } = await entriesQuery;

  if (entriesError) {
    console.error('[api/books/search] shelf_entries select failed', {
      name: entriesError.name,
      message: entriesError.message,
      code: entriesError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd wyszukiwania.' });
  }

  type EntryRow = {
    book_id: string;
    shelf_id: string;
    position_index: number | null;
    photo_id: string | null;
    detection_id: string | null;
    shelves: { id: string; name: string } | null;
  };
  const placement = new Map<
    string,
    {
      shelf_id: string;
      shelf_name: string;
      position_index: number | null;
      photo_id: string | null;
      detection_id: string | null;
    }
  >();
  for (const e of (entries ?? []) as EntryRow[]) {
    placement.set(e.book_id, {
      shelf_id: e.shelf_id,
      shelf_name: e.shelves?.name ?? '',
      position_index: e.position_index,
      photo_id: e.photo_id,
      detection_id: e.detection_id,
    });
  }

  const bookIds = [...placement.keys()];
  if (bookIds.length === 0) {
    return apiResponse({ data: { books: [], total: 0 } });
  }

  // 2. books filtrowane przez book_ids z aktualnych placementów + search/color/read/purchase
  let booksQuery = locals.supabase
    .from('books')
    .select(
      'id, title, authors, cover_url, published_year, is_read, spine_color, isbn_13, isbn_10, publisher, user_cover_url, cover_photo_url, cover_source, purchase_date, purchase_price, purchase_city, purchase_event',
    )
    .in('id', bookIds);

  if (q && q.trim()) {
    // Escape ILIKE wildcards żeby user input traktować dosłownie
    const escaped = q
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, (m) => `\\${m}`);
    booksQuery = booksQuery.ilike('search_text', `%${escaped}%`);
  }
  if (color) {
    booksQuery = booksQuery.eq('spine_color', color);
  }
  if (read === 'read') booksQuery = booksQuery.eq('is_read', true);
  else if (read === 'unread') booksQuery = booksQuery.eq('is_read', false);

  // Filtry zakupowe (book-purchase-metadata).
  if (purchase_event) booksQuery = booksQuery.eq('purchase_event', purchase_event);
  if (purchase_city) {
    const escaped = purchase_city.replace(/[\\%_]/g, (m) => `\\${m}`);
    booksQuery = booksQuery.ilike('purchase_city', `%${escaped}%`);
  }
  if (purchase_date_from) booksQuery = booksQuery.gte('purchase_date', purchase_date_from);
  if (purchase_date_to) booksQuery = booksQuery.lte('purchase_date', purchase_date_to);
  if (purchase_price_min !== undefined)
    booksQuery = booksQuery.gte('purchase_price', purchase_price_min);
  if (purchase_price_max !== undefined)
    booksQuery = booksQuery.lte('purchase_price', purchase_price_max);

  const { data: books, error: booksError } = await booksQuery.order('title', { ascending: true });

  if (booksError) {
    console.error('[api/books/search] books select failed', {
      name: booksError.name,
      message: booksError.message,
      code: booksError.code,
    });
    return apiError({ code: 'INTERNAL_ERROR', status: 500, message: 'Błąd wyszukiwania.' });
  }

  const result: CatalogBookDTO[] = (books ?? []).map((b) => {
    const p = placement.get(b.id)!;
    return {
      id: b.id,
      title: b.title,
      authors: b.authors,
      cover_url: b.cover_url,
      published_year: b.published_year,
      is_read: b.is_read,
      spine_color: b.spine_color,
      position_index: p.position_index,
      shelf_id: p.shelf_id,
      shelf_name: p.shelf_name,
      photo_id: p.photo_id,
      detection_id: p.detection_id,
      isbn_13: b.isbn_13,
      isbn_10: b.isbn_10,
      publisher: b.publisher,
      user_cover_url: b.user_cover_url,
      cover_photo_url: b.cover_photo_url,
      cover_source: (b.cover_source ?? 'auto') as CoverSource,
      purchase_date: b.purchase_date ?? null,
      purchase_price: b.purchase_price ?? null,
      purchase_city: b.purchase_city ?? null,
      purchase_event: b.purchase_event ?? null,
    };
  });

  return apiResponse({ data: { books: result, total: result.length } });
};
