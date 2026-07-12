import { z } from 'zod';

export const AiResolutionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    title: z.string().min(1).max(300),
    authors: z.array(z.string()).default([]),
    isbn10: z.string().nullable(),
    isbn13: z.string().nullable(),
    publisher: z.string().nullable(),
    publishedYear: z.number().int().nullable(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({ status: z.literal('not_found'), reason: z.string().nullable() }),
]);

export type AiResolutionResult = z.infer<typeof AiResolutionResultSchema>;
