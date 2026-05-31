# Research: Photo Matching Failures and Better Retrieval Strategy

Date: 2026-05-31

Scope:
- photo `9a154e01-7e6e-4c39-8018-1bf084273386`
- photo `ca035e1e-a58d-42ff-86be-66eb521853e1`
- current retrieval pipeline in `src/lib/books/googleBooks.ts`
- current scoring pipeline in `src/lib/matching/score.ts`

## Current pipeline summary

Current retrieval logic:
1. optional `isbn:` lookup
2. `intitle:<clean title> + inauthor:<clean author>` when author exists
3. free-text fallback for title variants from `titleQueryVariants()`

Current normalization logic:
- Cyrillic homoglyph cleanup
- year-range stripping like `1985-2003`
- title split into main segment for subtitle/series cases

Current scoring logic:
- title similarity weight: `0.65`
- author similarity weight: `0.30`
- ISBN bonus: `0.05`
- persistence threshold: `MATCH_MID = 0.55`

Important limitation of the current design:
- retrieval is mostly Google Books only
- OpenLibrary is used only as ISBN enrichment after Google already returned something with ISBN
- there is no dedicated fallback for author-only spines, swapped title/author, or noisy OCR that preserves only part of the true title

## Cross-case conclusion

The dominant problem is retrieval, not only scoring.

Patterns observed:
- Google Books often fails on Polish/local editions, comics, graphic novels, and noisy OCR titles.
- When OCR captures an author as the title, the current pipeline still treats it as a title query and returns arbitrary books by that author.
- When title OCR is noisy but author OCR is strong, the system lacks an author-guided fallback that can recover the correct book.
- Current score is character-Levenshtein-heavy, which is brittle for OCR distortions like `Armini Krew` vs `Zakon Mimów`, `Filutек` vs `Filutek`, or subtitle-heavy comic volumes.

## Case A: photo `9a154e01-7e6e-4c39-8018-1bf084273386`

### Stored state

Latest succeeded vision run:
- `8af731e3-0848-45c0-a8d3-aad3f74bf1fc`
- created at `2026-05-30T12:03:27.370769+00:00`

Observed persisted detections:
- 19 detections had status `matched`
- only 4 detections had any `book_candidates`
- 15 detections had `candidate_count = 0`

This exposed a bug in the rematch endpoint:
- the endpoint marked detections as `matched` even when rematch produced zero candidates
- fixed in `src/pages/api/photos/[id]/match.ts`

### Detection-level findings

Detected with real candidates:
- `HERKULES POIROT – CYRYLE` -> top candidate `Herkules Poirot - A.B.C.` score `0.66`
- `ZA GARŚĆ NIEODOLARÓW` -> `Za garść neodolarów` score `0.818`
- `COŚ ZABIJA DZIECIAKI` + `James Tynion` -> `Coś zabija dzieciaki` score `1.0`
- `POPIOŁY DZIECIŃSTWA` -> `Popioły dzieciństwa` score `0.85`

Failed or unstable examples:

1. `Prof. Filutек 1967-1984` / `Prof. Filutек 1985-2003`
- Google Books can return relevant results
- OCR author was `LENOREV` instead of `Lengren`
- relevant candidate scores landed near the threshold
- for `1967-1984`, `Profesor Filutek 1967-1984 Czesc 2` scored about `0.526`
- result: retrieval partially works, but score is too brittle when title and author are both mildly damaged

2. `Y: OSTATNI Z MĘŻCZYZN – JEDEN MAŁY KROK`
- current Google query can return the correct volume
- measured candidate `Y ostatni z mezczyzn Jeden maly krok` scored about `0.689`
- however, persisted DB state for this detection had zero candidates
- likely explanation: rematch erased previous results with an empty or worse Google response on a later run

3. `DIVINITY`
- Google Books returns mostly game-related or unrelated English results
- best measured score was about `0.547`, just below threshold
- result: retrieval is weak and current threshold/filter removes the best available candidate

4. `ZNAMY SIĘ OD DZIECKA`
- Google Books returns weak or unrelated results
- measured scores remained around `0.18-0.21`
- result: pure retrieval failure

5. `Asprа KOBRA`, `Asprа KOBRA ZŁOTA KOLEKCJA`
- Cyrillic homoglyph cleanup helps, but Google Books still returns no useful result
- result: retrieval failure on local/graphic content

### Conclusion for photo A

Photo A proves three separate failure classes:
- correct retrieval exists but current rematch can overwrite with empty results
- correct retrieval exists but score drops below threshold because OCR noise damages title/author too much
- correct retrieval does not exist in Google Books for some local/comic titles

## Case B: photo `ca035e1e-a58d-42ff-86be-66eb521853e1`

### Stored state

Latest succeeded vision run:
- `78d65553-3a62-4909-9df0-e7a5b6f5fedd`
- created at `2026-05-29T05:45:17.245201+00:00`

Important observation:
- this photo still has persisted candidates with scores `0.29-0.51`
- that is below current `MATCH_MID = 0.55`
- therefore these candidates are not representative of the current filter behavior
- practical reading: this photo was matched before the current persistence threshold behavior was applied, or it has not been re-matched under the current logic

### Detection #5: `Poraniona błyskawica` / `Natasza Socha`

Persisted candidates:
- `Nasza klasa` score `0.513`
- `Kiedy ślub?` score `0.448`
- `Zaczarowane` score `0.448`

Research results:
- `intitle:Poraniona błyskawica + inauthor:Natasza Socha` -> `0` results in Google Books
- title-only query -> irrelevant results
- `inauthor:Natasza Socha` -> author bibliography only, starting with `Nasza klasa`, `Kiedy ślub?`, `Zaczarowane`

Interpretation:
- current system is not finding the title
- it is effectively guessing from author bibliography when author-only results dominate
- this is unsafe behavior and should not produce auto-suggested concrete titles without stronger evidence

### Detection #9: `RACHEL CAINE`

Persisted candidates:
- `Total Eclipse` score `0.40`
- `Weather Warden Collection` score `0.382`
- `Two Weeks' Notice` score `0.353`
- `Ash and Quill` score `0.35`

Research results:
- title query `RACHEL CAINE` returns books by Rachel Caine
- OCR clearly captured author-only text, not a title

Interpretation:
- current pipeline misclassifies author-only spine text as title
- this should be a separate retrieval mode
- when only author is known, the system needs a guarded bibliography mode and stronger reranking before proposing any specific book

### Detection #10: `CZAS ŻNIW`

Persisted candidates:
- `Pochodnia` score `0.294`
- other results are clearly unrelated

Research results:
- title-only query `CZAS ŻNIW` -> mostly junk
- `intitle:Czas Żniw + inauthor:Samantha Shannon` -> direct hit: `Czas Żniw. Wersja autorska`
- `Samantha Shannon Czas Żniw` also returns the correct book high in results

Interpretation:
- this is the strongest evidence that retrieval strategy is the main problem
- when author is available or inferable, author-guided fallback can recover the correct book

### Detection #11: `Armini Krew` / `Samantha Shannon`

Persisted candidates:
- `Skrull Kill Krew` score `0.378`
- remaining candidates are junk

Research results:
- `intitle:Armini Krew + inauthor:Samantha Shannon` -> no results
- `inauthor:Samantha Shannon` returns known Samantha Shannon titles
- author-guided queries surface `Czas Żniw. Wersja autorska`, `Zakon Mimów. Wersja autorska`, and other series books

Interpretation:
- OCR likely damaged the title strongly enough that literal title retrieval fails
- current Levenshtein-heavy title scoring is too brittle for this class of OCR error
- author-guided retrieval is still useful, but matching must compare token structure and series context better than raw character distance

### `Okorelety Pani Peregrine`

Research results:
- Google Books title query -> `0` results
- Google Books `intitle + inauthor:Ransom Riggs` -> `0` results
- Google Books `inauthor:Ransom Riggs` -> author bibliography only; title still not recovered directly
- Lubimyczytac search for `Okorelety Pani Peregrine` returns `Osobliwy dom pani Peregrine` as the first result

Interpretation:
- this is a real fuzzy-retrieval success case for a Polish book source
- it demonstrates that stronger title fuzziness can work in principle
- it also demonstrates that Google Books retrieval is insufficient for heavily corrupted Polish titles

## Source evaluation

### Google Books

Strengths:
- easy API access
- good metadata quality when it has the book
- works reasonably for mainstream titles and ISBN-enriched results

Weaknesses observed in these cases:
- poor recovery for heavily misspelled Polish titles
- weak coverage for some comics, local editions, and niche Polish releases
- author-only queries tend to produce bibliography lists that are not enough for safe matching

### OpenLibrary

Current role:
- only ISBN enrichment after Google already found a candidate with ISBN

Observed limitation:
- not helping retrieval when Google fails first

### Lubimyczytac

Observed behavior:
- fuzzy search can recover heavily misspelled Polish titles like `Okorelety Pani Peregrine`

Operational constraint:
- page text explicitly forbids automated extraction and AI processing
- do not use Lubimyczytac scraping as a production integration path

### Goodreads

Observed behavior:
- current Goodreads `/api` page does not expose a usable public API for this use case
- it is not a realistic product integration path here

Conclusion:
- Goodreads is not the right next source
- the right next step is a better retrieval/matching algorithm on current sources and then evaluation of legal metadata sources with better Polish coverage

## Crop and OCR diagnostics

Artifacts saved locally:
- source photos and bbox exports: `docs/image-analysis/research-cases/`
- padded crops and enhancement variants: `docs/image-analysis/research-cases/crops/`
- exact-bbox crops and rotated variants: `docs/image-analysis/research-cases/crops-tight/`

Environment findings:
- Pillow available in the current Python environment
- `numpy` available
- `pytesseract` not installed
- `cv2` not installed
- `tesseract` executable not installed system-wide

Operational conclusion:
- a classical local OCR experiment was not possible without installing new tooling
- vision-LLM-on-crop was still possible and was used as a proxy experiment for targeted OCR quality

### What crop-level LLM reading proved

For photo A, targeted crop reading improved OCR materially in some cases.

1. `A_p01` (`Prof. Filutek 1985-2003`)
- full-pipeline OCR stored: `Prof. Filutек 1985-2003` + author `LENOREV`
- crop-level LLM reading recovered:
	- probable title: `Prof. Filutek 1985-2003`
	- probable author: `Lengren`
- conclusion: per-spine crop fallback can repair OCR enough to unblock retrieval and scoring

2. `A_p11` (`DIVINITY`)
- padded crop misled the crop LLM toward neighboring `COŚ ZABIJA DZIECI`
- exact-bbox crop with center-focused prompt recovered `DIVINITY`
- conclusion: crop fallback works only when localization is tight and the prompt is explicit about which spine to read

3. `A_p16` (`Kajko i Kokosz – Złota Kolekcja`)
- padded crop LLM correctly inferred `Kajko i Kokosz – Złota Kolekcja`
- exact-bbox crop LLM misread stylized lettering as `KOKORO KOKOZ`
- conclusion: stylized comic lettering remains hard even after crop isolation; crop fallback helps, but cannot be treated as guaranteed truth

### What crop diagnostics proved about photo B

Photo B exposed a more fundamental problem than OCR quality.

For positions `#9`, `#10`, `#11`:
- exact-bbox crops did not isolate a single book
- instead they showed narrow vertical strips crossing multiple horizontally stacked spines
- crop-level reading returned mixed fragments from many books, not the intended target

Examples:
- `B_p11` stored detection was `Armini Krew — Samantha Shannon`
- exact crop prominently contained `HOLLY JACKSON` from adjacent books, not a Samantha Shannon spine
- `B_p09` stored detection was `RACHEL CAINE`, but exact crop showed mixed fragments like `EMNICE`, `krew`, `Prz`, `zbrodni`, not a Rachel Caine spine
- `B_p10` stored detection was `CZAS ŻNIW`, but exact crop again intersected multiple titles rather than one clean book

Conclusion:
- for photo B, the primary failure is not only OCR or matching
- the bbox localization for these detections is not adequate for per-book OCR recovery
- any OCR fallback on these cases will remain noisy until localization is improved

### Preprocessing value

Simple preprocessing tested:
- autocontrast
- grayscale + stronger contrast
- sharpened contrast
- thresholded black/white
- exact bbox without padding
- rotation to horizontal orientation

Findings:
- preprocessing helps when the bbox already isolates the target reasonably well
- preprocessing does not solve multi-book crop contamination
- grayscale + contrast did not materially improve the hard photo B case; it still surfaced `HOLLY JACKSON`, which confirms localization, not text clarity, is the dominant blocker there

## Refined conclusions from image-side research

There are two distinct fallback opportunities:

1. OCR repair fallback
- use when bbox is already good enough
- crop the detected spine
- run enhancement variants
- use targeted OCR/vision on the crop to repair title/author before metadata retrieval
- best for cases like `Prof. Filutek 1985-2003`

2. Localization repair fallback
- use when bbox intersects multiple books or obviously wrong neighbors
- re-run a localized vision pass asking for a tighter box around the single intended spine
- or add a separate image-localization stage before OCR/matching
- this is required for cases like photo B positions `#9-#11`

## Best image-side strategy for failed matches

Recommended fallback chain after low-confidence or failed metadata match:

1. Check crop quality from bbox
- if crop visually contains one dominant spine -> run OCR repair fallback
- if crop contains multiple spines -> do not trust OCR; run localization repair fallback first

2. OCR repair fallback
- create exact crop and one padded crop
- create 2-3 enhancement variants, not an open-ended set
- run targeted OCR/vision prompt on the crop only
- output repaired `candidate_title_text` and `candidate_author_text`

3. Localization repair fallback
- ask the vision model to refine the bbox around the single spine near the original detection center
- or segment the shelf region more tightly before OCR

4. Retrieval with repaired text
- then run the improved matching cascade described earlier: title+author, author-guided bibliography, inversion handling, guarded rerank

## Best overall algorithm after all research

The strongest combined solution is a two-stage fallback:

### Stage A: better retrieval and matching
- classify detection as title-dominant / author-dominant / mixed
- try direct `title + author`
- if it fails, try author-guided bibliography retrieval
- support title/author inversion
- rerank with hybrid token + edit-distance score

### Stage B: image repair only for hard cases
- trigger only when top score is low, no candidates found, or OCR smells wrong
- inspect crop quality from bbox
- if crop is clean, use crop-level OCR/LLM repair
- if crop is not clean, repair localization before OCR

Practical priority order:
1. author-guided bibliography fallback
2. conservative rematch persistence
3. crop-level OCR fallback for clean bboxes
4. tighter bbox/localization fallback for messy layouts like photo B

This order gives the highest likely win per implementation cost.

## Best search strategy for these failure modes

### 1. Detect the OCR mode before searching

Classify each detection into one of these buckets:
- title-dominant
- author-dominant
- mixed title+author
- low-information / ambiguous

Useful heuristics:
- all-caps two-token strings that look like person names are often author-only
- commas and multi-surname patterns are strong author signals
- single word or very short token strings are weak title evidence
- if `raw_title` and `raw_author` are both present but one is low-entropy or name-like, swap confidence between them instead of trusting fields literally

### 2. Retrieval cascade should branch by bucket

Recommended retrieval cascade:

For mixed title+author:
1. `intitle:<clean title> + inauthor:<clean author>`
2. `clean title` free-text
3. `inauthor:<author> <important title tokens>`
4. `author bibliography` mode: fetch top N books for author and rerank by title similarity

For title-dominant with no author:
1. full clean title
2. main title segment
3. token-subset queries from rare/long title tokens
4. neighbor-assisted author inference from adjacent detections on the same photo if confidence is high

For author-dominant:
1. do not treat raw text as title
2. fetch author bibliography only
3. if there is no second signal, show `manual review needed` instead of specific low-confidence proposals
4. if adjacent detections on the same shelf indicate a series/author cluster, use that as weak context only for reranking

For low-information / ambiguous:
1. avoid overconfident candidate proposals
2. prefer manual correction flow

### 3. Add author-guided bibliography reranking

This is the most practical next improvement.

When title retrieval fails but author seems reliable:
- fetch the author's books from Google Books
- build a bibliography candidate set
- compare OCR title against each candidate title
- choose candidates only if the reranked title evidence is materially better than the generic baseline

This directly addresses:
- `CZAS ŻNIW` + `Samantha Shannon`
- `Armini Krew` + `Samantha Shannon`
- weak title OCR with strong author OCR

Guardrail:
- author-only bibliography mode should not auto-promote a concrete title unless title similarity clears a stronger threshold than normal retrieval

### 4. Support title/author inversion

The user hypothesis is correct and should be implemented.

If `intitle(title) + inauthor(author)` fails:
- test whether `title` looks like an author field
- test whether `author` looks like title residue or is empty/noisy
- if inversion seems plausible, run an inverted retrieval branch

Example value:
- `RACHEL CAINE` should be treated as author-first, not title-first

### 5. Replace pure character-distance ranking with hybrid similarity

Current ranking is too dependent on raw Levenshtein.

Recommended scoring components:
- token overlap similarity on normalized title words
- character similarity as secondary signal, not primary signal
- author similarity with alias/initial handling
- series/volume bonus for tokens like `tom`, `część`, `vol`, numbered subtitles
- penalty for bibliography mode when title evidence is weak
- penalty when candidate genre/language obviously mismatches shelf context if such metadata becomes available

Suggested direction:
- title score should combine token Jaccard or token F1 with edit-distance similarity
- long-token matches should matter more than stopwords
- subtitles and series suffixes should be downweighted, not treated as full title loss

### 6. Make rematch conservative

Rematch should not destroy better historical evidence.

Recommended policy:
- if new candidate set is empty and old candidate set was non-empty, keep old set unless the user explicitly requests hard refresh
- if new top score is materially worse than old top score, keep old set or store both runs for comparison
- persist match run metadata separately from vision run so retrieval regressions are auditable

This directly addresses the `Y: OSTATNI Z MĘŻCZYZN – JEDEN MAŁY KROK` type regression.

## Matching recommendations by confidence band

Recommended interpretation bands:
- `>= 0.80`: strong candidate, can be preselected
- `0.65 - 0.79`: useful candidate, show prominently
- `0.45 - 0.64`: only show if it comes from title+author retrieval or strong bibliography reranking
- `< 0.45`: usually suppress from UI unless debugging mode or explicit fallback review mode

This is stricter than the old persisted results and safer for author-bibliography guesses.

## Best practical next steps

Priority 1:
- implement retrieval-mode classification: title vs author vs mixed
- add author-guided bibliography fallback
- add inversion fallback when title field looks like author text

Priority 2:
- introduce hybrid token+edit-distance title similarity
- make rematch conservative so it cannot erase better prior candidates with empty results

Priority 3:
- evaluate legal metadata sources with better Polish coverage
- do not plan around Goodreads
- do not plan around Lubimyczytac scraping

## Final recommendation

The best next algorithm is not “more sources first”. It is:
1. better retrieval branching
2. author-guided bibliography fallback
3. title/author inversion handling
4. stronger hybrid matching instead of raw Levenshtein dominance
5. conservative rematch persistence

If only one improvement is implemented first, it should be this:

`When direct title+author retrieval fails, switch to author-bibliography retrieval and rerank by fuzzy title similarity, but only surface candidates when title evidence clears a guarded threshold.`

That single change would materially improve:
- `CZAS ŻNIW`
- `Armini Krew`
- many cases where OCR title is damaged but author OCR is still good
