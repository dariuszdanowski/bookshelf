import { z } from 'zod';

export type BookCandidate = {
  source: 'google_books' | 'open_library';
  externalId: string;
  title: string;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  coverUrl: string | null;
};

export type ScoredCandidate = BookCandidate & { matchScore: number };

export type BookSearchResult =
  | { ok: true; candidates: BookCandidate[] }
  | { ok: false; reason: 'rate_limited' | 'network' | 'empty' };

// DTO for API responses (Phase 3 review page)
export const BookCandidateDTOSchema = z.object({
  id: z.string(),
  source: z.string(),
  externalId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  isbn10: z.string().nullable(),
  isbn13: z.string().nullable(),
  publisher: z.string().nullable(),
  publishedYear: z.number().nullable(),
  coverUrl: z.string().nullable(),
  matchScore: z.number(),
  rank: z.number(),
});

export type BookCandidateDTO = z.infer<typeof BookCandidateDTOSchema>;
