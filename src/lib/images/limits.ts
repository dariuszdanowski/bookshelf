// UWAGA: ten plik nie może importować NIC — ani `@cf-wasm/photon/workerd` (workerd-only),
// ani cokolwiek innego. Zero importów jest jedyną gwarancją, że pozostaje bezpieczny do
// zbundlowania zarówno po stronie serwera (resize.ts, crop.ts, upload-file.ts), jak i po
// stronie klienta (PhotoUploader.tsx — client island). Nie dodawaj tu żadnego importu.
// Zob. plan-review context/changes/hotfix-photon-oom-guard/reviews/plan-review.md (F1/F2).

// Photon WASM dekoduje skompresowany JPEG do surowych pikseli przed jakąkolwiek operacją
// (resize/crop) — np. 8MB skompresowanego JPEG-a może rozwinąć się do 100-200MB surowych
// pikseli w pamięci. Limit pamięci Workera Cloudflare to 128MB (stały, niezależny od planu
// Free/Paid), więc zbyt duże wejście crashuje izolat (OOM) zamiast rzucić catchable wyjątek.
// 8MB to zwalidowany w produkcji bezpieczny próg.
export const MAX_PHOTON_INPUT_BYTES = 8 * 1024 * 1024;
