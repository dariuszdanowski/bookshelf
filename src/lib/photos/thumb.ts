// M15: konwencja ścieżki miniatury w Storage — `<storage_path>.thumb.jpg`,
// generowana server-side w upload-file (photon, lib/images/resize.ts →
// deriveThumbnail), best-effort. Brak miniatury (legacy/HEIC/błąd) → lista
// fallbackuje do oryginału. UWAGA: moduł celowo zod-free — importują go
// browser-islands, a photos/schema.ts ciągnie zod do bundle'a (bloat + stale Vite deps).
export const THUMB_SUFFIX = '.thumb.jpg';
