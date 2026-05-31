# Plan: Better Book Identification Paths

Date: 2026-06-01

Related research:
- `docs/matching-research-2026-05-31.md`
- `docs/proces-identyfikacji-ksiazek.md`

Context:
- current production path uses Claude Vision for full-shelf detection
- current runtime preprocessing is only resize + JPEG compression in `src/lib/images/resize.ts`
- there is no classical OCR in the app runtime today
- research showed two distinct failure modes:
  - retrieval/matching failure even when OCR is mostly usable
  - image localization failure where bbox does not isolate a single book

This document defines two implementation plans:
1. a non-LLM OCR path
2. a low-cost fallback path with a second image analysis pass only for hard cases

---

## Executive recommendation

Both paths have value, but they solve different parts of the problem.

Best practical order:
1. implement the low-cost fallback path first
2. then add a non-LLM OCR path as an optional or secondary stage

Reasoning:
- the fallback path is closer to the current architecture
- it gives the fastest lift for examples like `Prof. Filutek`
- it can be targeted to low-confidence cases, so cost stays bounded
- non-LLM OCR has real potential, but without bbox quality repair it will still fail on layouts like photo `ca035e1e-a58d-42ff-86be-66eb521853e1`

---

## Current state

### What is already done today

Current app image preprocessing in `src/lib/images/resize.ts`:
- resize longer edge to `1568 px`
- Lanczos resampling
- re-encode to JPEG quality `85`

Current app does not do:
- CLAHE
- autocontrast
- brightness adjustment
- sharpening
- deskew / rotation correction
- per-spine crop enhancement
- classical OCR

### What the external PoC `bookshelf_scanner` does

`C:/Projekty/10xDevs/bookshelf_scanner/bookshelf_scanner.py` adds:
- crop of low-confidence books
- second pass on crop
- enhancement pipeline:
  - resize
  - contrast
  - brightness
  - sharpness

But it still uses an LLM for the crop analysis.

Conclusion:
- `bookshelf_scanner` is not an OCR-without-LLM solution
- its main value is the fallback-on-crop idea, not the current production model choice

---

## Plan A: Non-LLM OCR Path

### Goal

Reduce dependence on Claude credits by adding a classical OCR stage that can read clean or moderately noisy spine crops without another LLM call.

### What this plan is for

Best-fit cases:
- good bbox, weak first OCR
- vertical or nearly vertical spine text
- plain typography, non-stylized covers
- cases where we already know the crop contains mostly one book

Weak-fit cases:
- stylized comic lettering
- decorative fonts
- very dark glossy spines
- bbox that crosses several books

### Recommended OCR candidates

Priority order:

1. `PaddleOCR`
- best candidate for quality on real photos
- stronger text detection than plain Tesseract
- better angle handling
- higher implementation weight

2. `Tesseract`
- easiest conceptual choice
- mature and fully offline
- weaker on stylized, vertical, and noisy spine text

3. `EasyOCR`
- acceptable for PoC
- simpler to try than PaddleOCR
- not my first long-term choice if quality matters

### Architecture options

#### Option A1: Separate OCR service

Recommended for production if you go beyond course scope.

Shape:
- app stays on Cloudflare Workers
- OCR runs in a separate service outside Workers
- app sends crop image and receives OCR text candidates

Pros:
- no heavy OCR dependencies inside Workers
- easier to use Python/OpenCV/PaddleOCR stack
- clean isolation of compute-heavy stage

Cons:
- another service to deploy and monitor
- extra latency
- more moving parts

#### Option A2: Local or offline support tool

Recommended for course-safe experimentation.

Shape:
- keep app path unchanged
- add a local script or support tool that runs OCR on saved crops from failed cases

Pros:
- easiest way to validate ROI
- no production infrastructure change
- cheap and low risk

Cons:
- not integrated into user flow
- mostly diagnostic until promoted into product architecture

#### Option A3: Browser-side OCR

Possible, but not the first choice.

Shape:
- crop in browser
- run JS OCR library on client device

Pros:
- no server OCR infrastructure
- no worker limitations

Cons:
- weaker libraries in practice
- performance variability on user devices
- more complex browser pipeline

### Recommended implementation for this repo

For this project, the best non-LLM OCR plan is:
- Phase 1: local/offline OCR validator
- Phase 2: if quality is good enough, separate OCR microservice

Not recommended as first step:
- embedding full OCR into Cloudflare Workers

### Proposed pipeline

1. Full-shelf Claude Vision pass remains stage 1.
2. For failed or low-confidence detections, inspect bbox quality.
3. If bbox is clean:
   - create exact crop
   - create rotated and contrast-enhanced variants
   - run OCR on those variants
   - merge OCR outputs into `candidate_title_text` and `candidate_author_text`
4. Feed repaired text into improved metadata retrieval and matching.
5. If bbox is not clean:
   - skip OCR
   - route to localization repair path

### OCR preprocessing bundle

Use a small fixed bundle, not an open-ended lab pipeline.

Recommended variants per crop:
- exact bbox
- exact bbox rotated to horizontal text
- grayscale + autocontrast
- grayscale + stronger contrast
- sharpened color variant

Do not start with:
- dozens of variants
- aggressive thresholding on all cases
- full CLAHE pipeline for every crop

### Matching integration

Non-LLM OCR should not directly decide the book.

Instead it should emit:
- repaired title text
- repaired author text
- text confidence
- orientation used
- crop quality score

Then matching should use:
- title + author retrieval
- author bibliography fallback
- inversion handling
- hybrid token + edit-distance reranking

### Success criteria

Minimum useful win:
- materially better title/author recovery on clean crops like `Prof. Filutek`
- no regression on already-correct easy cases
- reduced need for second Claude call on at least a meaningful subset of low-confidence cases

### Risks

Main risks:
- OCR quality too weak on stylized Polish comic spines
- false confidence from OCR on poor crops
- service complexity if promoted too early into production

### Best first slice for Plan A

Slice A1:
- build a local OCR evaluation tool on saved research crops
- compare PaddleOCR vs Tesseract on 20-30 known hard crops
- record text recovery rate and downstream match improvement

Decision gate:
- if OCR can reliably recover enough text on clean crops, move to service design
- if not, keep OCR as optional diagnostic tooling only

---

## Plan B: Low-Cost Fallback with Second Image Analysis Pass

### Goal

Improve accuracy without fully replacing the current Claude Vision path, while keeping additional credit usage bounded and targeted.

### What this plan is for

Best-fit cases:
- low-confidence detections
- detections with zero candidates
- detections where retrieval fails but crop quality is good
- cases where a narrow crop can recover text better than whole-shelf analysis

Research-backed examples:
- `Prof. Filutek 1985-2003`
- `Divinity` after tighter crop

### Core idea

Do not run a second image pass for every book.

Run it only when a detection meets one of these triggers:
- `vision_confidence < threshold`
- no candidates after matching
- top match score below review threshold
- text smells wrong, e.g. author-like string in title field

### Recommended fallback flow

1. Stage 1: current full-shelf Claude Vision pass
2. Stage 2: metadata retrieval + matching
3. Trigger evaluation per detection
4. If triggered:
   - inspect bbox quality
   - generate focused crop(s)
   - run second vision pass only on crop
   - retry retrieval/matching with repaired text

### Bbox quality gate

This is required.

Before second pass, classify crop quality:
- `clean_single_spine`
- `multi_spine_overlap`
- `uncertain_localization`

Behavior:
- `clean_single_spine` -> run crop fallback
- `multi_spine_overlap` -> do not waste second pass on OCR; first repair localization
- `uncertain_localization` -> manual fallback or localization refinement stage

This directly addresses the failure mode seen on photo `ca035e1e-a58d-42ff-86be-66eb521853e1`.

### Preprocessing to add before second pass

Minimal recommended preprocessing:
- exact bbox crop
- exact bbox crop rotated to horizontal text
- autocontrast
- grayscale + contrast

Optional later:
- sharpen variant
- padded crop beside exact crop

Avoid first:
- large image-processing matrix
- expensive multi-variant fanout on every detection

### Prompt strategy for second pass

The second pass should be much narrower than the current full-shelf prompt.

It should ask only for:
- visible title text
- visible author text
- confidence
- ambiguity notes

It should not ask for:
- every book on the shelf
- left-to-right enumeration
- broad global reasoning about the whole image

### Cost control

This plan is viable only with strict gating.

Budget rules:
- only one extra pass per detection at most
- only for triggered detections
- cap triggered detections per photo
- skip if bbox quality is poor

Expected effect:
- most easy books still cost one full-shelf call only
- hard books get selective extra spend

### Recommended runtime architecture

For this repo, the lowest-risk implementation is:
- keep stage 1 inside current `process` path
- move crop fallback into rematch or a dedicated review-time endpoint

Reason:
- not every upload needs the extra cost
- review time is where low-confidence cases are already visible
- the user can tolerate slightly slower resolution only on hard detections

### Best product shape

Recommended endpoint shape:
- `POST /api/detections/[id]/refine`

Responsibilities:
- fetch latest photo and detection bbox
- generate crop variants
- run narrow image analysis on crop
- return repaired title/author suggestion
- optionally rerun matching for that detection only

This is better than reprocessing the whole photo.

### Success criteria

Minimum useful win:
- improved recovery on a subset of failed detections without doubling cost for all detections
- visible gain on known cases like `Prof. Filutek`
- no automatic invocation on clearly bad bbox crops

### Risks

Main risks:
- using extra credits on crops that are actually localization failures
- hallucination on stylized or multi-book crops
- too much complexity if fallback is hidden inside the main upload path

### Best first slice for Plan B

Slice B1:
- add crop-quality classification and a manual per-detection refine endpoint
- run second pass only on explicit user action or only for top failing cases

Slice B2:
- once quality is proven, allow automatic fallback for a small bounded set of detections

---

## Direct comparison

### Plan A: Non-LLM OCR

Best at:
- reducing credit spend over time
- deterministic offline text extraction on clean crops
- long-term architecture if you want less vendor dependence

Weak at:
- stylized covers
- poor localization
- rapid integration inside current Workers stack

### Plan B: Second image analysis pass

Best at:
- fastest accuracy gain in current architecture
- leveraging the same vision capability already proven to help on clean crops
- easier incremental rollout

Weak at:
- still spends credits
- still depends on LLM behavior
- must be gated carefully to stay cheap

---

## Combined roadmap

### Phase 1: Immediate win

Implement Plan B first:
- crop-quality gate
- narrow crop refinement endpoint
- improved retrieval/matching after refined text

### Phase 2: Credit reduction

Prototype Plan A offline:
- evaluate PaddleOCR and Tesseract on research crops
- keep only if it recovers enough text on clean single-spine crops

### Phase 3: Hybrid path

Best hybrid model:
- try non-LLM OCR first on clean crops
- if OCR confidence is low, use second LLM crop pass
- if bbox is poor, repair localization before either one

This gives the best cost/quality balance.

---

## Concrete recommendation for this repo

If the goal is best ROI for the course and current budget:

1. Build the low-cost fallback first.
2. Keep it detection-scoped, not full-photo scoped.
3. Add crop enhancement before that fallback.
4. In parallel, run a short OCR benchmark on saved crops.
5. Promote OCR into architecture only if the benchmark is clearly useful on real cases.

If only one plan can be implemented now, choose Plan B.

If both can proceed in sequence, do this:
- now: Plan B
- next: Plan A benchmark
- later: hybrid fallback chain

---

## Suggested implementation slices

### Slice 1: Crop refinement endpoint

Deliverables:
- per-detection crop generator
- 2-3 enhancement variants
- narrow crop-analysis prompt
- response payload with repaired text fields

### Slice 2: Better retrieval after refined text

Deliverables:
- author-guided bibliography fallback
- title/author inversion handling
- hybrid reranking improvements

### Slice 3: OCR benchmark tool

Deliverables:
- offline script for OCR on saved crops
- compare PaddleOCR vs Tesseract on real failures
- report with text recovery and downstream matching impact

### Slice 4: Hybrid decision engine

Deliverables:
- bbox quality classifier
- choose among:
  - no fallback
  - OCR fallback
  - crop LLM fallback
  - localization repair first

---

## Definition of done

This planning effort is complete when:
- both paths are written down with architecture and rollout order
- the repo has a single markdown artifact preserving these plans
- the next implementation slice can be selected without reopening broad design discussion
