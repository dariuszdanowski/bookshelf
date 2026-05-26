---
change_id: fix-cloudflare-runtime-env
title: Server reads runtime.env (Worker bindings) zamiast import.meta.env
status: implemented
created: 2026-05-26
updated: 2026-05-26
archived_at: null
---

## Notes

serwer (Astro middleware + endpointy) musi czytać sekrety Supabase z Astro.locals.runtime.env (Worker bindings), nie z import.meta.env (Vite build-time inlining) — produkcyjny deploy padał z "Brak PUBLIC_SUPABASE_URL" mimo prawidłowo ustawionych Worker secrets; browser client pozostaje na import.meta.env ale wymaga env w GitHub Actions build step
