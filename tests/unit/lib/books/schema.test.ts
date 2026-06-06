import { describe, it, expect } from 'vitest';
import {
  ConfirmDetectionSchema,
  CorrectDetectionSchema,
  ConfirmBatchSchema,
  UpdateBookReadSchema,
  UpdateBookSchema,
  AddPurchaseSchema,
  SearchBooksQuerySchema,
} from '../../../../src/lib/books/schema';

// ---------------------------------------------------------------------------
// ConfirmDetectionSchema
// ---------------------------------------------------------------------------

describe('ConfirmDetectionSchema', () => {
  it('akceptuje poprawny UUID jako candidate_id', () => {
    const result = ConfirmDetectionSchema.safeParse({
      candidate_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca brakujący candidate_id', () => {
    const result = ConfirmDetectionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('odrzuca niepoprawny UUID candidate_id', () => {
    const result = ConfirmDetectionSchema.safeParse({ candidate_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('odrzuca dodatkowe pola', () => {
    // Zod strip — nie błąd; ale candidate_id musi być UUID
    const result = ConfirmDetectionSchema.safeParse({
      candidate_id: '550e8400-e29b-41d4-a716-446655440000',
      extra: 'field',
    });
    // strip mode: extra pola są cicho usuwane, schema PASS
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CorrectDetectionSchema — wariant field_edit
// ---------------------------------------------------------------------------

describe('CorrectDetectionSchema — field_edit', () => {
  const validBase = {
    mode: 'field_edit' as const,
    candidate_id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Mistrz i Małgorzata',
  };

  it('akceptuje minimalny field_edit (title + candidate_id)', () => {
    const result = CorrectDetectionSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('akceptuje field_edit z pełnymi opcjonalnymi polami', () => {
    const result = CorrectDetectionSchema.safeParse({
      ...validBase,
      authors: ['Michaił Bułhakow'],
      publisher: 'Czytelnik',
      published_year: 1967,
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca pusty tytuł', () => {
    const result = CorrectDetectionSchema.safeParse({ ...validBase, title: '' });
    expect(result.success).toBe(false);
  });

  it('odrzuca brakujący candidate_id w field_edit', () => {
    const { candidate_id: _, ...withoutCandidate } = validBase;
    const result = CorrectDetectionSchema.safeParse(withoutCandidate);
    expect(result.success).toBe(false);
  });

  it('odrzuca niepoprawny UUID candidate_id', () => {
    const result = CorrectDetectionSchema.safeParse({ ...validBase, candidate_id: 'bad' });
    expect(result.success).toBe(false);
  });

  it('odrzuca rok spoza zakresu', () => {
    const result = CorrectDetectionSchema.safeParse({ ...validBase, published_year: 999 });
    expect(result.success).toBe(false);
    const result2 = CorrectDetectionSchema.safeParse({ ...validBase, published_year: 2101 });
    expect(result2.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CorrectDetectionSchema — wariant manual_entry
// ---------------------------------------------------------------------------

describe('CorrectDetectionSchema — manual_entry', () => {
  const validManual = {
    mode: 'manual_entry' as const,
    title: 'Nieznana książka',
  };

  it('akceptuje minimalny manual_entry (tylko title)', () => {
    const result = CorrectDetectionSchema.safeParse(validManual);
    expect(result.success).toBe(true);
  });

  it('akceptuje manual_entry z autorami i isbn_13', () => {
    const result = CorrectDetectionSchema.safeParse({
      ...validManual,
      authors: ['Autor Nieznany'],
      isbn_13: '9788301055011',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca isbn_13 o złym formacie (nie 13 cyfr)', () => {
    const result = CorrectDetectionSchema.safeParse({
      ...validManual,
      isbn_13: '978-83-010-5501-1', // z myślnikami — invalid
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca isbn_10 o złym formacie', () => {
    const result = CorrectDetectionSchema.safeParse({
      ...validManual,
      isbn_10: '123',
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca brak tytułu', () => {
    const result = CorrectDetectionSchema.safeParse({ mode: 'manual_entry' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConfirmBatchSchema
// ---------------------------------------------------------------------------

describe('ConfirmBatchSchema', () => {
  const validItem = {
    detection_id: '550e8400-e29b-41d4-a716-446655440001',
    candidate_id: '550e8400-e29b-41d4-a716-446655440002',
  };

  it('akceptuje listę z jednym poprawnym item', () => {
    const result = ConfirmBatchSchema.safeParse({ items: [validItem] });
    expect(result.success).toBe(true);
  });

  it('akceptuje wiele items', () => {
    const result = ConfirmBatchSchema.safeParse({
      items: [
        validItem,
        {
          detection_id: '550e8400-e29b-41d4-a716-446655440003',
          candidate_id: '550e8400-e29b-41d4-a716-446655440004',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca pustą listę items', () => {
    const result = ConfirmBatchSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/pusta/i);
    }
  });

  it('odrzuca item z niepoprawnym UUID detection_id', () => {
    const result = ConfirmBatchSchema.safeParse({
      items: [{ ...validItem, detection_id: 'not-uuid' }],
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca item z niepoprawnym UUID candidate_id', () => {
    const result = ConfirmBatchSchema.safeParse({
      items: [{ ...validItem, candidate_id: 'bad' }],
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca brak pola items', () => {
    const result = ConfirmBatchSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpdateBookReadSchema
// ---------------------------------------------------------------------------

describe('UpdateBookReadSchema', () => {
  it('akceptuje is_read: true', () => {
    const result = UpdateBookReadSchema.safeParse({ is_read: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_read).toBe(true);
  });

  it('akceptuje is_read: false', () => {
    const result = UpdateBookReadSchema.safeParse({ is_read: false });
    expect(result.success).toBe(true);
  });

  it('odrzuca brak is_read', () => {
    const result = UpdateBookReadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('odrzuca is_read jako string', () => {
    const result = UpdateBookReadSchema.safeParse({ is_read: 'true' });
    expect(result.success).toBe(false);
  });

  it('odrzuca dodatkowe pola (.strict())', () => {
    const result = UpdateBookReadSchema.safeParse({ is_read: true, title: 'hack' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AddPurchaseSchema (S-06 Flow B)
// ---------------------------------------------------------------------------

describe('AddPurchaseSchema', () => {
  it('akceptuje minimalny (tylko title)', () => {
    const result = AddPurchaseSchema.safeParse({ title: 'Wiedźmin' });
    expect(result.success).toBe(true);
  });

  it('akceptuje pełny zakup z datą i metadanymi', () => {
    const result = AddPurchaseSchema.safeParse({
      title: 'Wiedźmin: Ostatnie życzenie',
      authors: ['Andrzej Sapkowski'],
      publisher: 'superNOWA',
      published_year: 1993,
      isbn_13: '9788375780635',
      purchase_date: '2026-05-29',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca brak title', () => {
    const result = AddPurchaseSchema.safeParse({ authors: ['X'] });
    expect(result.success).toBe(false);
  });

  it('odrzuca pusty title', () => {
    const result = AddPurchaseSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('odrzuca złą datę (nie YYYY-MM-DD)', () => {
    const result = AddPurchaseSchema.safeParse({ title: 'X', purchase_date: '29-05-2026' });
    expect(result.success).toBe(false);
  });

  it('odrzuca zły isbn_13 (nie 13 cyfr)', () => {
    const result = AddPurchaseSchema.safeParse({ title: 'X', isbn_13: '978-83' });
    expect(result.success).toBe(false);
  });

  it('odrzuca rok spoza zakresu', () => {
    expect(AddPurchaseSchema.safeParse({ title: 'X', published_year: 999 }).success).toBe(false);
    expect(AddPurchaseSchema.safeParse({ title: 'X', published_year: 2101 }).success).toBe(false);
  });

  it('akceptuje sloty okładki (unify-add-cover): user_cover_url + cover_photo_url + cover_source', () => {
    const result = AddPurchaseSchema.safeParse({
      title: 'X',
      cover_url: 'https://auto.jpg',
      user_cover_url: 'https://user.jpg',
      cover_photo_url: 'https://photo.jpg',
      cover_source: 'photo',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca zły cover_source', () => {
    expect(AddPurchaseSchema.safeParse({ title: 'X', cover_source: 'xyz' }).success).toBe(false);
  });

  it('odrzuca user_cover_url który nie jest URL', () => {
    expect(AddPurchaseSchema.safeParse({ title: 'X', user_cover_url: 'nie-url' }).success).toBe(
      false,
    );
  });

  it('odrzuca dodatkowe pola (.strict)', () => {
    const result = AddPurchaseSchema.safeParse({ title: 'X', user_id: 'hack' });
    expect(result.success).toBe(false);
  });

  // S-17: opis z kandydata (BookModal add) → books.description → search_text
  it('akceptuje description (string ≤2000), null i brak pola', () => {
    expect(AddPurchaseSchema.safeParse({ title: 'X', description: 'Saga rodzinna.' }).success).toBe(
      true,
    );
    expect(AddPurchaseSchema.safeParse({ title: 'X', description: null }).success).toBe(true);
    expect(AddPurchaseSchema.safeParse({ title: 'X' }).success).toBe(true);
  });

  it('odrzuca description dłuższy niż 2000 znaków', () => {
    expect(AddPurchaseSchema.safeParse({ title: 'X', description: 'a'.repeat(2001) }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// UpdateBookSchema — description (S-17, per-book backfill przez PATCH)
// ---------------------------------------------------------------------------

describe('UpdateBookSchema — description (S-17)', () => {
  it('akceptuje samodzielny description (≥1 pole spełnione)', () => {
    expect(UpdateBookSchema.safeParse({ description: 'Motyw przewodni sagi.' }).success).toBe(true);
  });

  it('akceptuje description: null (wyczyść)', () => {
    expect(UpdateBookSchema.safeParse({ description: null }).success).toBe(true);
  });

  it('odrzuca description dłuższy niż 2000 znaków', () => {
    expect(UpdateBookSchema.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SearchBooksQuerySchema (S-08)
// ---------------------------------------------------------------------------

describe('SearchBooksQuerySchema', () => {
  it('akceptuje pusty obiekt (wszystkie filtry opcjonalne)', () => {
    expect(SearchBooksQuerySchema.safeParse({}).success).toBe(true);
  });

  it('akceptuje pełny zestaw filtrów', () => {
    const result = SearchBooksQuerySchema.safeParse({
      q: 'smok',
      color: 'czerwony',
      shelf_ids: ['00000000-0000-4000-8000-000000000001'],
      read: 'unread',
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca kolor spoza palety', () => {
    expect(SearchBooksQuerySchema.safeParse({ color: 'turkusowy' }).success).toBe(false);
  });

  it('odrzuca nieznany status read', () => {
    expect(SearchBooksQuerySchema.safeParse({ read: 'maybe' }).success).toBe(false);
  });

  it('akceptuje read=all', () => {
    expect(SearchBooksQuerySchema.safeParse({ read: 'all' }).success).toBe(true);
  });

  it('odrzuca shelf_ids z nie-UUID', () => {
    expect(SearchBooksQuerySchema.safeParse({ shelf_ids: ['nie-uuid'] }).success).toBe(false);
  });
});
