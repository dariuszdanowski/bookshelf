import { z } from 'zod';

import type { BookCandidateDTO } from '../books/schema';

const SHA256_REGEX = /^[0-9a-f]{64}$/;

export const RecordPhotoSchema = z.object({
  shelf_id: z.uuid(),
  storage_path: z.string().min(1),
  file_hash_sha256: z.string().regex(SHA256_REGEX).optional(),
});

export type RecordPhotoInput = z.infer<typeof RecordPhotoSchema>;

// PATCH /api/photos/:id — przeniesienie zdjęcia na inną półkę. `photos` nie ma
// kolumny title/caption, więc jedyne edytowalne metadane to shelf_id (S-29).
export const UpdatePhotoSchema = z.object({
  shelf_id: z.uuid(),
});

export type UpdatePhotoInput = z.infer<typeof UpdatePhotoSchema>;

export const CheckDuplicateSchema = z.object({
  hash: z.string().regex(SHA256_REGEX),
});

export type CheckDuplicateInput = z.infer<typeof CheckDuplicateSchema>;

export type PhotoDTO = {
  id: string;
  shelf_id: string;
  status: string;
  detected_count: number | null;
  error_message: string | null;
  vision_cost_usd: number | null;
  vision_latency_ms: number | null;
  created_at: string;
  file_hash_sha256?: string | null;
};

export type BboxCoords = { x1: number; y1: number; x2: number; y2: number };

export type BboxEditSet = {
  updated: Array<{ detectionId: string; bbox: BboxCoords }>;
  removed: Array<{ detectionId: string }>;
  added: Array<{ bbox: BboxCoords }>;
};

export type DetectionDTO = {
  position_index: number;
  raw_title: string;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
  bbox: BboxCoords | null;
};

export type PhotoListItemDTO = {
  id: string;
  status: string;
  stage: 'uploaded' | 'processing' | 'vision_done' | 'match_done' | 'confirmed';
  created_at: string;
  thumbnail_url: string | null;
  detected_count: number;
  matched_count: number;
  confirmed_count: number;
  latest_vision_run: {
    id: string;
    model: string | null;
    created_at: string;
    cost_usd: number | null;
  } | null;
  has_running_run: boolean;
  // true gdy `file_hash_sha256 IS NULL` — zdjęcie wgrane przed wdrożeniem
  // deduplikacji (S-16). Surowego hash NIE eksponujemy.
  legacy_no_hash: boolean;
  /** M26: pełny koszt AI zdjęcia (wszystkie vision_runs + refine_calls);
   *  null gdy suma niedostępna (degrade) — UI fallbackuje do latest runu. */
  total_cost_usd?: number | null;
};

export type ShelfPhotosResponse = {
  photos: PhotoListItemDTO[];
};

export type DetectionWithCandidatesDTO = {
  id: string;
  position_index: number;
  raw_title: string;
  raw_author: string | null;
  vision_confidence: number | null;
  spine_color: string | null;
  bbox: BboxCoords | null;
  status: string;
  candidates: BookCandidateDTO[];
  duplicate: { type: 'exact' | 'edition'; shelfHint?: string } | null;
  /** M26: suma kosztów OCR (refine) tej detekcji — etykieta przycisku $ */
  refine_cost_usd?: number;
};
