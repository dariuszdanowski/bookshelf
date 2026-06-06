# Follow-ups z impl-review (unified-book-modal, 2026-06-06)

Deferred findingi (low-impact, brak aktualnego buga). Do podjęcia przy przyszłym hardeningu.

- [ ] **F2** — `src/lib/matching/findCandidates.ts:38`: propaguj `rate_limited` z OpenLibrary/Biblioteka Narodowa (dziś tylko Google Books). MVP-acceptable bo BN/OL keyless; ale partial-source outage cicho zwraca mniej kandydatów bez sygnału UI.
- [ ] **F3** — `src/components/BookModal.tsx:97` `CoverThumb`: dodać `useEffect(() => setFailed(false), [url])` (jak w `CoverLarge:129`). Teraz brak buga (klucze listy z indeksem → remount); regresja tylko przy stabilnych kluczach + reorder.
