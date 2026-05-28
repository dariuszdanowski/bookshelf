-- 0006_detection_bbox.sql
-- Dodaje znormalizowane koordynaty bbox (0..1) do detections.
-- Używane do highlight UI i przyszłej re-analizy fragmentu (crop z oryginału).
-- Konwencja: [x1,y1,x2,y2] top-left, względem wymiaru working-copy 1568px
-- (co = wymiary oryginału po normalizacji przez Claude).
-- nullable: bbox to best-effort z vision; brak nie blokuje detekcji.

alter table detections
  add column if not exists bbox_x1 numeric(5,4),
  add column if not exists bbox_y1 numeric(5,4),
  add column if not exists bbox_x2 numeric(5,4),
  add column if not exists bbox_y2 numeric(5,4);
