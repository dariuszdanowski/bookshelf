---
id: local-supabase-dev-access
title: Lokalna baza developerska dostępna z Windows + przepięcie dev/E2E na lokal
status: implementing
created: 2026-06-10
updated: 2026-06-11
---

# local-supabase-dev-access

## Problem

Astro dev server (Windows) nie dosięga lokalnego stacku Supabase (WSL2) — blokuje go
**Hyper-V firewall WSL VM** (`DefaultInboundAction: Block`, VMCreatorId `{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}`).
Skutek: dev + E2E celują w **chmurową** Supabase (aktywny profil `.dev.vars` = `remote`,
`foqpoqdbicgsrbkcuckc.supabase.co`) → egress **9,53 GB / 5 GB** (free tier przekroczony ~2×)
+ **341 MAU** (akumulacja signupów z `auth.setup.ts` przeciw chmurze). Fair Use grace do **9 lipca 2026**.

## Cel

Doprowadzić do tego, by lokalna baza była **osiągalna z Windows**, przepiąć dev + E2E na nią
na stałe i **zatrzymać egress** generowany przez development.
