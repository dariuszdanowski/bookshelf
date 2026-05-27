import { z } from 'zod';

import { SPINE_COLORS } from './prompt';

const DetectionItemSchema = z.object({
  position: z.number().int().positive(),
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
  spine_color: z.enum(SPINE_COLORS).nullable(),
});

export const DetectionSchema = z.array(DetectionItemSchema);

export type Detection = z.infer<typeof DetectionItemSchema>;
