import { z } from 'zod';

export const RecordPhotoSchema = z.object({
  shelf_id: z.uuid(),
  storage_path: z.string().min(1),
});

export type RecordPhotoInput = z.infer<typeof RecordPhotoSchema>;

export type PhotoDTO = {
  id: string;
  shelf_id: string;
  status: string;
  detected_count: number | null;
  error_message: string | null;
  vision_cost_usd: number | null;
  vision_latency_ms: number | null;
  created_at: string;
};

export type DetectionDTO = {
  position_index: number;
  raw_title: string;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
};
