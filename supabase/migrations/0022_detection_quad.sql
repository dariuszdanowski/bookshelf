-- 0022_detection_quad.sql
-- Dodaje pole bbox_quad do detekcji — czworokąt o dowolnym kształcie.
-- Format JSONB: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] (0..1, clockwise od TL).
-- nullable: fallback do bbox_x1/y1/x2/y2 gdy null.
-- vision model wstawia null; user ustawia ręcznie w edytorze overlay.
alter table public.detections
  add column if not exists bbox_quad jsonb;
