# Camera Capture — Plan Brief

> Full plan: `context/changes/camera-capture/plan.md`

## What & Why

Dodajemy przycisk „Zrób zdjęcie" do strony `/upload`, który na telefonie otwiera natywny
aparat systemu, a na desktopie wyświetla inline podgląd z `getUserMedia`. Motywacja:
eliminacja kroku „zrób zdjęcie aparatem → przenieś na komputer → załaduj" w typowym
flow mobilnym.

## Starting Point

`PhotoUploader.tsx` ma gotowy `handleFile(file: File)` jako punkt wejścia dla każdego
pliku. Jedyna ścieżka pobrania pliku to `<input type="file">` + drag-drop. Brak
`getUserMedia` / `MediaDevices` w całym codebase.

## Desired End State

Na `/upload` dwa przyciski: „Wybierz plik" (istniejący) i „Zrób zdjęcie" (nowy). Na
telefonie drugi otwiera natywny aparat. Na desktopie otwiera inline panel z podglądem
wideo, przyciskiem przechwycenia klatki i anulowania. Po zrobieniu zdjęcia reszta pipeline
(SHA-256 dedup → Storage upload → vision → match) bez zmian.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
|---|---|---|---|
| Mobile implementation | `<input capture="environment">` | Zero JS, natywna UX systemu | Plan |
| Desktop implementation | `getUserMedia` + `CameraPreview.tsx` | Inline, bez modala | Plan |
| Feature detection | Runtime `navigator.mediaDevices?.getUserMedia` | SSR-safe, nie user-agent | Plan |
| Stream cleanup | `track.stop()` na unmount + po capture | Wskaźnik kamery w OS | Plan |
| E2E | `--use-fake-device-for-media-stream` + addInitScript | Playwright-native | Plan |
| Brak zmian API/DB | Tak | File → istniejący handleFile() | Plan |

## Scope

**In scope:**
- `<input capture="environment">` + „Zrób zdjęcie" przycisk w PhotoUploader.tsx
- `CameraPreview.tsx` z getUserMedia + video + canvas capture
- Permission-denied error inline
- E2E tests z fake-device / mock getUserMedia
- Playwright config: `--use-fake-device-for-media-stream`

**Out of scope:**
- Crop/zoom w podglądzie
- Nagrywanie wideo
- Wybór kamery front/back na desktopie
- Zmiany API / DB

## Architecture / Approach

```
PhotoUploader.tsx
├── "Wybierz plik" → fileInputRef (istniejące)
└── "Zrób zdjęcie"
    ├── mobile: cameraInputRef (<input capture="environment">)
    └── desktop (supportsDesktopCamera): setCameraOpen(true)
                └── <CameraPreview>
                    ├── getUserMedia({ video: { facingMode: 'environment' } })
                    ├── <video autoPlay muted playsInline>
                    ├── canvas.toBlob → File
                    └── onCapture(file) → handleFile(file) ← ten sam pipeline
```

## Phases at a Glance

| Faza | Co dostarcza | Główne ryzyko |
|---|---|---|
| 1. Mobile Capture | Przycisk + input capture | Brak (czysto HTML) |
| 2. Desktop Camera | CameraPreview + getUserMedia | Stream cleanup / permission UX |
| 3. E2E Tests | Playwright fake-device + mock | Flakiness na fake stream |

**Prerequisites:** branch `change/camera-capture` od świeżego main; PR #80 (cost-analysis-view) może być niepomergowany — brak konfliktów (różne pliki).
**Estimated effort:** ~1-2 sesje, 3 fazy.

## Open Risks & Assumptions

- `--use-fake-device-for-media-stream` w Playwright args może wpłynąć na inne E2E testy
  wymagające realnych mediów (w tym projekcie: brak takich testów).
- HTTPS wymagany dla `getUserMedia` — prod OK (CF Workers), dev localhost OK,
  ale lokalne IP (WSL NAT) może wymagać dodatkowej konfiguracji (poza zakresem).

## Success Criteria (Summary)

- Przycisk „Zrób zdjęcie" widoczny na `/upload` obok „Wybierz plik"
- Na mobile: otwiera natywny aparat systemowy
- Na desktop: inline podgląd, capture produkuje plik wchodzący w normalny pipeline
