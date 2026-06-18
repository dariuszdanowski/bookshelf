import { z } from 'zod';

import { SPINE_COLORS } from './prompt';

// identity-first (v7): model nie zwraca bbox — pole jest absent → .default(null) normalizuje do null.
// Best-effort: invalid bbox (out-of-range, wrong length, pixel coords) → null rather than aborting parse.
// Backward-compat: historyczne v6-responses z bboxem parsują się normalnie.
const BboxSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .nullable()
  .optional()
  .catch(null)
  .default(null);

const DetectionItemSchema = z.object({
  position: z.number().int().positive(),
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullable().catch(null),
  confidence: z.number().min(0).max(1),
  // v4: orientation field — best-effort, optional for backward compat
  orientation: z.enum(['vertical', 'horizontal']).optional().catch(undefined),
  spine_color: z.enum(SPINE_COLORS).nullable().catch(null),
  bbox: BboxSchema,
});

export const DetectionSchema = z.array(DetectionItemSchema);

export type Detection = z.infer<typeof DetectionItemSchema>;
