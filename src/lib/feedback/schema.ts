import { z } from 'zod';

export const FeedbackSchema = z.object({
  title: z.string().min(1, 'Tytuł jest wymagany').max(200, 'Maksymalnie 200 znaków'),
  description: z.string().min(1, 'Opis jest wymagany').max(2000, 'Maksymalnie 2000 znaków'),
  url: z.string().max(500).optional(),
});

export type FeedbackInput = z.infer<typeof FeedbackSchema>;
