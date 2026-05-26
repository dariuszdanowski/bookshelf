---
change_id: header-nav-when-auth
title: Header nav z linkiem do /shelves dla zalogowanego usera + pivot landing CTA na /shelves
status: archived
created: 2026-05-27
updated: 2026-05-27
archived_at: 2026-05-26T22:37:11Z
---

## Notes

Stream E micro-slice (S-13). Naprawia UX gap dostrzeżony po merge S-02: zalogowany nigdzie nie widzi linka do `/shelves` (musi wpisywać URL), a CTA z landing page (S-09 „Przejdź do biblioteki") prowadzi do `/library` które jeszcze nie istnieje (przyjdzie w S-08).

Scope:
- `src/layouts/Layout.astro`: dorzucamy link „Moje półki" do header'a dla auth user'a (przed email + LogoutButton).
- `src/pages/index.astro`: pivot CTA target z `/library` na `/shelves` — honest UX („daj user'owi link tam gdzie naprawdę coś jest"). Po S-08 powstanie /library wrócimy do oryginalnej intencji S-09.

Out of scope: brand link, anon header, multi-page nav z aktywnym state (focus ring on current page), itp. — tylko 2 minimalne edycje.
