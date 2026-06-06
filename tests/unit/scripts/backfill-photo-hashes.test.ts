import { describe, it, expect } from 'vitest';
import { backfillPhotoHashes, sha256hex } from '../../../scripts/backfill-photo-hashes.mjs';

interface FakePhoto {
  id: string;
  user_id: string;
  storage_path: string;
  file_hash_sha256: string | null;
  created_at: number;
  /** symulacja braku pliku w Storage */
  missingInStorage?: boolean;
  /** symulacja 23505 przy UPDATE (duplikat hash u usera) */
  duplicateOnUpdate?: boolean;
  /** symulacja innego błędu UPDATE */
  failOnUpdate?: boolean;
}

const silentLog = { log: () => {}, error: () => {}, warn: () => {} };

/**
 * Fake klienta Supabase odwzorowujący zachowanie filtra `IS NULL` + range():
 * wiersze zaktualizowane wypadają ze zbioru przy KOLEJNYM zapytaniu —
 * dokładnie ta semantyka powodowała shifting-window bug.
 */
function makeFakeSupabase(photos: FakePhoto[]) {
  const updates: Array<{ id: string; hash: string }> = [];

  return {
    updates,
    photos,
    from(table: string) {
      if (table !== 'photos') throw new Error(`Nieoczekiwana tabela: ${table}`);
      return {
        select() {
          return {
            is(col: string, val: null) {
              if (col !== 'file_hash_sha256' || val !== null)
                throw new Error('Nieoczekiwany filtr');
              return {
                order() {
                  return {
                    range(from: number, to: number) {
                      const nullRows = photos
                        .filter((p) => p.file_hash_sha256 === null)
                        .sort((a, b) => a.created_at - b.created_at);
                      return Promise.resolve({
                        data: nullRows.slice(from, to + 1).map(({ id, user_id, storage_path }) => ({
                          id,
                          user_id,
                          storage_path,
                        })),
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
        update(payload: { file_hash_sha256: string }) {
          return {
            eq(_col: string, id: string) {
              const photo = photos.find((p) => p.id === id);
              if (!photo) return Promise.resolve({ error: { message: 'not found', code: 'X' } });
              if (photo.duplicateOnUpdate)
                return Promise.resolve({
                  error: { message: 'duplicate key value', code: '23505' },
                });
              if (photo.failOnUpdate)
                return Promise.resolve({ error: { message: 'boom', code: '57014' } });
              photo.file_hash_sha256 = payload.file_hash_sha256;
              updates.push({ id, hash: payload.file_hash_sha256 });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          download(storagePath: string) {
            const photo = photos.find((p) => p.storage_path === storagePath);
            if (!photo || photo.missingInStorage)
              return Promise.resolve({
                data: null,
                error: { message: 'Object not found' },
              });
            // Deterministyczna „zawartość pliku" = bajty ze storage_path
            const bytes = new TextEncoder().encode(storagePath);
            return Promise.resolve({
              data: { arrayBuffer: () => Promise.resolve(bytes.buffer) },
              error: null,
            });
          },
        };
      },
    },
  };
}

function makePhotos(
  count: number,
  overrides: Record<number, Partial<FakePhoto>> = {},
): FakePhoto[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `photo-${i}`,
    user_id: 'user-1',
    storage_path: `user-1/photo-${i}.jpg`,
    file_hash_sha256: null,
    created_at: i,
    ...overrides[i],
  }));
}

describe('sha256hex', () => {
  it('liczy hex SHA-256 zgodny z SubtleCrypto', () => {
    // echo -n "abc" | sha256sum
    const bytes = new TextEncoder().encode('abc');
    expect(sha256hex(bytes.buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('backfillPhotoHashes', () => {
  it('przetwarza wszystkie zdjęcia w jednej stronie', async () => {
    const fake = makeFakeSupabase(makePhotos(3));
    const result = await backfillPhotoHashes(fake, { pageSize: 50, log: silentLog });
    expect(result).toEqual({ processed: 3, skipped: 0, errors: 0 });
    expect(fake.updates).toHaveLength(3);
  });

  it('przetwarza WSZYSTKIE wiersze przy wielu stronach (regresja: shifting-window offset)', async () => {
    // 120 zdjęć, pageSize 50 → 3 strony. Stary kod przesuwał offset o pełną
    // stronę mimo że zaktualizowane wiersze wypadły z filtra IS NULL —
    // run gubił ~połowę rekordów.
    const fake = makeFakeSupabase(makePhotos(120));
    const result = await backfillPhotoHashes(fake, { pageSize: 50, log: silentLog });
    expect(result.processed).toBe(120);
    expect(fake.photos.every((p) => p.file_hash_sha256 !== null)).toBe(true);
  });

  it('dry-run niczego nie aktualizuje, a offset przesuwa się o pełne strony (bez pętli nieskończonej)', async () => {
    const fake = makeFakeSupabase(makePhotos(120));
    const result = await backfillPhotoHashes(fake, {
      dryRun: true,
      pageSize: 50,
      log: silentLog,
    });
    expect(result.processed).toBe(120);
    expect(fake.updates).toHaveLength(0);
    expect(fake.photos.every((p) => p.file_hash_sha256 === null)).toBe(true);
  });

  it('pomija zdjęcie bez pliku w Storage i mimo to dochodzi do końca zbioru', async () => {
    const fake = makeFakeSupabase(makePhotos(60, { 0: { missingInStorage: true } }));
    const result = await backfillPhotoHashes(fake, { pageSize: 50, log: silentLog });
    expect(result).toEqual({ processed: 59, skipped: 1, errors: 0 });
  });

  it('duplikat 23505 liczy jako skipped, inne błędy UPDATE jako errors', async () => {
    const fake = makeFakeSupabase(
      makePhotos(3, { 1: { duplicateOnUpdate: true }, 2: { failOnUpdate: true } }),
    );
    const result = await backfillPhotoHashes(fake, { pageSize: 50, log: silentLog });
    expect(result).toEqual({ processed: 1, skipped: 1, errors: 1 });
  });

  it('rzuca przy błędzie pobierania strony', async () => {
    const fake = {
      from() {
        return {
          select() {
            return {
              is() {
                return {
                  order() {
                    return {
                      range() {
                        return Promise.resolve({
                          data: null,
                          error: { message: 'connection refused' },
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
      storage: { from: () => ({ download: () => Promise.resolve({ data: null, error: null }) }) },
    };
    await expect(backfillPhotoHashes(fake, { log: silentLog })).rejects.toThrow(
      /connection refused/,
    );
  });

  it('zapisany hash odpowiada treści pliku (zgodność z hashem z przeglądarki)', async () => {
    const fake = makeFakeSupabase(makePhotos(1));
    await backfillPhotoHashes(fake, { pageSize: 50, log: silentLog });
    const expected = sha256hex(new TextEncoder().encode('user-1/photo-0.jpg').buffer);
    expect(fake.updates[0].hash).toBe(expected);
  });
});
