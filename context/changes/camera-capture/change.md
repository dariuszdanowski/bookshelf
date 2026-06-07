---
change_id: camera-capture
title: "S-42: Zdjęcie półki prosto z kamery (mobile capture + desktop getUserMedia)"
status: implementing
created: 2026-06-07
updated: 2026-06-07
---

## Notes

Slice S-42 z roadmapy (dodany w uwagi-round3, 2026-06-07). Post-MVP feature świadomie
wyniesiony poza „NIE w MVP" — teraz jako slice rozwojowy.

Dwie warstwy:
1. **Mobile** — `<input capture="environment">` w PhotoUploader, nowy przycisk „Zrób zdjęcie",
   zero nowych API, reszta pipeline bez zmian.
2. **Desktop** — `getUserMedia` + inline `<video>` preview (`CameraPreview.tsx`) + canvas
   capture → `File` → istniejący `handleFile()`.

Brak migracji DB. Wynik obu ścieżek to `File` trafiający do istniejącego pipeline uploadu.
