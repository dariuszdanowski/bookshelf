import { z } from 'zod';

import { SPINE_COLORS } from './prompt';

// Best-effort: invalid bbox (out-of-range, wrong length, pixel coords) → null rather than aborting parse
const BboxSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .nullable()
  .optional()
  .catch(null);

const DetectionItemSchema = z.object({
  position: z.number().int().positive(),
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
  spine_color: z.enum(SPINE_COLORS).nullable(),
  bbox: BboxSchema,
});

export const DetectionSchema = z.array(DetectionItemSchema);

export type Detection = z.infer<typeof DetectionItemSchema>;
