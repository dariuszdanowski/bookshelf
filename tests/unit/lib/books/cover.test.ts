import { describe, it, expect } from 'vitest';
import { largeCoverUrl } from '../../../../src/lib/books/cover';

describe('largeCoverUrl', () => {
  it('podbija OpenLibrary -M.jpg → -L.jpg', () => {
    expect(largeCoverUrl('https://covers.openlibrary.org/b/id/12345-M.jpg')).toBe(
      'https://covers.openlibrary.org/b/id/12345-L.jpg'
    );
  });

  it('podbija OpenLibrary -S.jpg → -L.jpg (zachowuje query)', () => {
    expect(largeCoverUrl('https://covers.openlibrary.org/b/isbn/9788308073087-S.jpg?default=false')).toBe(
      'https://covers.openlibrary.org/b/isbn/9788308073087-L.jpg?default=false'
    );
  });

  it('podbija Google Books zoom=1 → zoom=2 i zdejmuje edge=curl', () => {
    const url = 'https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api';
    const out = largeCoverUrl(url);
    expect(out).toContain('zoom=2');
    expect(out).not.toContain('edge=curl');
  });

  it('zwraca nieznane źródło bez zmian', () => {
    expect(largeCoverUrl('https://example.com/cover.png')).toBe('https://example.com/cover.png');
  });

  it('null/undefined → null', () => {
    expect(largeCoverUrl(null)).toBeNull();
    expect(largeCoverUrl(undefined)).toBeNull();
  });
});
