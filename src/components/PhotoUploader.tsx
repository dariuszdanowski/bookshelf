import { useCallback, useEffect, useRef, useState } from 'react';

import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';
import { makeThumbnailBlob } from '../lib/images/browserThumb';
import type { PhotoDTO } from '../lib/photos/schema';
import { THUMB_SUFFIX } from '../lib/photos/thumb';
import type { ShelfDTO } from '../lib/shelves/schema';
import CameraPreview from './CameraPreview';
import HelpTip from './HelpTip';

type UploadStage =
  | 'idle'
  | 'uploading'
  | 'recording'
  | 'processing'
  | 'matching'
  | 'done'
  | 'error'
  | 'duplicate';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB cap (photon pamięć Worker 128MB)

// S-36: preferencja „Analizuj od razu" — kontrola kosztu vision per user.
const AUTO_PROCESS_STORAGE_KEY = 'bookshelf:upload-auto-process';

// crypto.randomUUID and crypto.subtle both require a secure context (HTTPS / localhost).
// On plain HTTP (e.g. LAN dev via IP), fall back to random strings so the flow
// completes without crashing. Dedup is skipped in those cases.
function safeRandomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return (
    Date.now().toString(16) +
    '-' +
    Math.random().toString(36).slice(2) +
    '-' +
    Math.random().toString(36).slice(2)
  );
}

async function computeSha256(file: File): Promise<string> {
  if (!crypto.subtle) {
    // Non-secure context (HTTP over LAN): return a random 64-char hex that passes
    // server validation but won't match any real hash, so dedup is naturally skipped.
    return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function PhotoUploader({
  userId,
  presetShelfId,
}: {
  userId: string;
  presetShelfId?: string;
}) {
  const [hasActiveKey, setHasActiveKey] = useState<boolean | null>(null);
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState('');
  const [stage, setStage] = useState<UploadStage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noApiKey, setNoApiKey] = useState(false);
  const [currentPhotoId, setCurrentPhotoId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [shelvesError, setShelvesError] = useState<string | null>(null);
  // true after vision succeeds but before match completes — retry can skip vision
  const [canRetryMatchOnly, setCanRetryMatchOnly] = useState(false);
  // Duplicate detection state
  const [duplicatePhotoId, setDuplicatePhotoId] = useState<string | null>(null);
  const [duplicateCreatedAt, setDuplicateCreatedAt] = useState<string | null>(null);
  // S-36: „Analizuj od razu" — odznaczone = upload kończy się na status='uploaded'
  // (zero wywołań vision/match = zero kosztu); analiza ręcznie z taba Zdjęcia.
  const [autoProcess, setAutoProcess] = useState(true);
  const [supportsDesktopCamera, setSupportsDesktopCamera] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [overlapWarning, setOverlapWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Ref mirrors stage for use inside callbacks without adding stage to dep arrays.
  const stageRef = useRef<UploadStage>('idle');
  const overlapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep stageRef in sync so callbacks can read latest stage without dep-array churn.
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  // Feature detection po hydratacji — navigator.mediaDevices nie istnieje w SSR.
  // Fix impl-review F6: na urządzeniach dotykowych (pointer: coarse) preferujemy
  // natywny aparat przez <input capture="environment"> — getUserMedia po HTTPS
  // istnieje też na telefonach, ale inline preview traci natywny UX aparatu
  // (focus/HDR/rozdzielczość). Desktop (fine pointer) → CameraPreview.
  useEffect(() => {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
    setSupportsDesktopCamera(
      typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !coarsePointer,
    );
  }, []);

  // Preferencja persystowana — odczyt po mount (hydration-safe).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(AUTO_PROCESS_STORAGE_KEY) === 'false') {
        setAutoProcess(false);
      }
    } catch {
      // localStorage niedostępny — zostaje default true
    }
  }, []);

  function handleAutoProcessChange(next: boolean) {
    setAutoProcess(next);
    try {
      window.localStorage.setItem(AUTO_PROCESS_STORAGE_KEY, String(next));
    } catch {
      // zapis niemożliwy — preferencja tylko w pamięci sesji
    }
  }

  useEffect(() => {
    fetch('/api/account/keys')
      .then((r) => r.json() as Promise<{ data?: { keys?: { is_active: boolean }[] } }>)
      .then((body) => {
        const active = (body.data?.keys ?? []).some((k) => k.is_active);
        setHasActiveKey(active);
      })
      .catch(() => {
        /* silent: don't block on key check failure */
      });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/shelves');
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { data: { shelves: ShelfDTO[] } };
        const list = json.data.shelves;
        setShelves(list);
        const preset =
          presetShelfId && list.some((s) => s.id === presetShelfId) ? presetShelfId : null;
        if (preset) setSelectedShelfId(preset);
        else if (list.length > 0) setSelectedShelfId(list[0].id);
      } catch (err) {
        setShelvesError(err instanceof Error ? err.message : 'Nie udało się pobrać półek.');
      }
    })();
  }, [presetShelfId]);

  const runMatch = useCallback(async (photoId: string) => {
    setStage('matching');
    const matchRes = await fetch(`/api/photos/${photoId}/match`, { method: 'POST' });
    const matchJson = (await matchRes.json()) as {
      data?: unknown;
      error?: { message?: string };
    };
    if (!matchRes.ok || !matchJson.data) {
      throw new Error(matchJson.error?.message ?? `Błąd matchowania (${matchRes.status})`);
    }
    setCanRetryMatchOnly(false);
    sessionStorage.removeItem('upload_resume_photo_id');
    window.location.href = `/photos/${photoId}`;
  }, []);

  const processPhoto = useCallback(
    async (photoId: string) => {
      setCanRetryMatchOnly(false);
      setNoApiKey(false);
      setStage('processing');
      const processRes = await fetch(`/api/photos/${photoId}/process`, { method: 'POST' });
      const processJson = (await processRes.json()) as {
        data?: { photo: PhotoDTO; detections: unknown[] };
        error?: { code?: string; message?: string };
      };
      if (!processRes.ok || !processJson.data) {
        if (processRes.status === 403 && processJson.error?.code === 'NO_API_KEY') {
          setNoApiKey(true);
        }
        throw new Error(processJson.error?.message ?? `Błąd przetwarzania (${processRes.status})`);
      }
      setCanRetryMatchOnly(true);
      await runMatch(photoId);
    },
    [runMatch],
  );

  // Recovery: resume pipeline for a photo stuck in 'processing' after page reload.
  useEffect(() => {
    const resumeId = sessionStorage.getItem('upload_resume_photo_id');
    if (!resumeId) return;
    (async () => {
      try {
        const res = await fetch(`/api/photos/${resumeId}`);
        if (!res.ok) {
          sessionStorage.removeItem('upload_resume_photo_id');
          return;
        }
        const json = (await res.json()) as {
          data?: {
            photo: { id: string; status: string };
            detections: Array<{ status: string }>;
          };
        };
        const photo = json.data?.photo;
        const detections = json.data?.detections ?? [];
        if (!photo) {
          sessionStorage.removeItem('upload_resume_photo_id');
          return;
        }

        setCurrentPhotoId(photo.id);

        if (photo.status === 'failed') {
          setErrorMsg('Poprzednie przetwarzanie zakończyło się błędem. Spróbuj ponownie.');
          setStage('error');
          sessionStorage.removeItem('upload_resume_photo_id');
        } else if (photo.status === 'uploaded' || photo.status === 'processing') {
          await processPhoto(photo.id);
        } else if (photo.status === 'processed') {
          const hasPending = detections.some((d) => d.status === 'pending');
          if (!hasPending) {
            sessionStorage.removeItem('upload_resume_photo_id');
            window.location.href = `/photos/${photo.id}`;
          } else {
            setCanRetryMatchOnly(true);
            await runMatch(photo.id);
          }
        } else {
          sessionStorage.removeItem('upload_resume_photo_id');
        }
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Błąd przy wznawianiu poprzedniego uploadu.',
        );
        setStage('error');
      }
    })();
  }, [processPhoto, runMatch]);

  // Core upload logic — called after duplicate check passes (or user forces upload).
  const doUpload = useCallback(
    async (file: File, sha256: string) => {
      setStage('uploading');
      const supabase = createBrowserSupabaseClient();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const storagePath = `${userId}/${safeRandomId()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('shelf-photos')
        .upload(storagePath, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (upErr) throw new Error(upErr.message);

      // M15: miniatura (canvas, max 640px) obok oryginału — lista zdjęć nie musi
      // ściągać wielomegabajtowych oryginałów. Best-effort: błąd NIE blokuje uploadu.
      try {
        const thumb = await makeThumbnailBlob(file);
        if (thumb) {
          const { error: thumbErr } = await supabase.storage
            .from('shelf-photos')
            .upload(`${storagePath}${THUMB_SUFFIX}`, thumb, {
              contentType: 'image/jpeg',
              upsert: false,
            });
          if (thumbErr) console.warn('[PhotoUploader] thumb upload failed', thumbErr.message);
        }
      } catch (thumbEx) {
        console.warn('[PhotoUploader] thumb generation failed', thumbEx);
      }

      setStage('recording');
      const recRes = await fetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shelf_id: selectedShelfId,
          storage_path: storagePath,
          file_hash_sha256: sha256,
        }),
      });
      const recJson = (await recRes.json()) as {
        data?: { photo: PhotoDTO };
        error?: { code?: string; message?: string };
      };

      // Race condition: another upload with same hash slipped in between check and insert
      if (recRes.status === 409 && recJson.error?.code === 'DUPLICATE_PHOTO') {
        setDuplicatePhotoId(null);
        setDuplicateCreatedAt(null);
        setStage('duplicate');
        return;
      }

      if (!recRes.ok || !recJson.data) {
        throw new Error(recJson.error?.message ?? `Błąd zapisu (${recRes.status})`);
      }
      const photoId = recJson.data.photo.id;
      setCurrentPhotoId(photoId);

      // S-36: skip — zdjęcie zostaje 'uploaded', bez vision/match (zero kosztu).
      // ŚWIADOMIE bez resume-state: recovery-effect wznowiłby pipeline wbrew
      // decyzji usera (pitfall z roadmapy). Lądujemy na tabie Zdjęcia, gdzie
      // czeka akcja „Uruchom vision".
      if (!autoProcess) {
        setStage('done');
        window.location.href = `/shelves/${selectedShelfId}?tab=photos`;
        return;
      }

      sessionStorage.setItem('upload_resume_photo_id', photoId);

      await processPhoto(photoId);
      setStage('done'); // redirect happens inside processPhoto; this line is reached only in tests
    },
    [selectedShelfId, userId, processPhoto, autoProcess],
  );

  const handleFile = useCallback(
    async (file: File) => {
      // Guard tylko na realnie trwające przetwarzanie — w 'error'/'duplicate'
      // nowy plik ma zaczynać świeży flow (fix impl-review F2: dawne
      // `!== 'idle'` blokowało restart po failu z mylącym komunikatem).
      const busyStages: UploadStage[] = ['uploading', 'recording', 'processing', 'matching'];
      if (busyStages.includes(stageRef.current)) {
        setOverlapWarning(true);
        if (overlapTimerRef.current) clearTimeout(overlapTimerRef.current);
        overlapTimerRef.current = setTimeout(() => setOverlapWarning(false), 4000);
        return;
      }
      if (!selectedShelfId) {
        setErrorMsg('Wybierz półkę przed uploadem.');
        return;
      }
      setErrorMsg(null);
      setCurrentPhotoId(null);
      setDuplicatePhotoId(null);
      setDuplicateCreatedAt(null);

      try {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error(`Plik jest za duży (max 15 MB). Wybierz mniejsze zdjęcie.`);
        }

        // SHA-256 in browser before Storage upload — zero cost when duplicate detected
        const sha256 = await computeSha256(file);

        // Check for existing photo with this hash (per user)
        const checkRes = await fetch(`/api/photos/check-hash?hash=${sha256}`);
        const checkJson = (await checkRes.json()) as {
          data?: { photo: { id: string; shelf_id: string; created_at: string } | null };
        };
        if (checkJson.data?.photo) {
          setDuplicatePhotoId(checkJson.data.photo.id);
          setDuplicateCreatedAt(checkJson.data.photo.created_at);
          setStage('duplicate');
          return;
        }

        await doUpload(file, sha256);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Nieznany błąd');
        setStage('error');
      }
    },
    [selectedShelfId, doUpload],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = '';
    },
    [handleFile],
  );

  const handleCameraCapture = useCallback(
    (file: File) => {
      setCameraOpen(false);
      void handleFile(file);
    },
    [handleFile],
  );

  const handleCameraCancel = useCallback(() => {
    setCameraOpen(false);
  }, []);

  const handleCancelDuplicate = useCallback(() => {
    setDuplicatePhotoId(null);
    setDuplicateCreatedAt(null);
    setStage('idle');
  }, []);

  const handleRetry = useCallback(async () => {
    if (!currentPhotoId) return;
    setErrorMsg(null);
    try {
      if (canRetryMatchOnly) {
        await runMatch(currentPhotoId);
      } else {
        await processPhoto(currentPhotoId);
      }
      setStage('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Nieznany błąd');
      setStage('error');
    }
  }, [currentPhotoId, canRetryMatchOnly, runMatch, processPhoto]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const isProcessing = ['uploading', 'recording', 'processing', 'matching'].includes(stage);

  const stageLabel: Record<UploadStage, string> = {
    idle: '',
    uploading: 'Wgrywanie do Storage...',
    recording: 'Zapisywanie rekordu...',
    processing: 'Analiza vision (może zająć ~10s)...',
    matching: 'Dopasowywanie do baz książek...',
    done: '',
    error: '',
    duplicate: '',
  };

  const formattedDuplicateDate = duplicateCreatedAt
    ? new Date(duplicateCreatedAt).toLocaleDateString('pl-PL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div data-testid="photo-uploader">
      {overlapWarning && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Poczekaj na zakończenie bieżącego przetwarzania przed wgraniem kolejnego zdjęcia.
        </div>
      )}
      {/* Shelf selector */}
      <div className="mb-4">
        <label
          htmlFor="shelf-select"
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
        >
          Półka
        </label>
        {shelvesError ? (
          <p
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
            data-testid="shelves-error"
          >
            {shelvesError}
          </p>
        ) : shelves.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Ładowanie półek...</p>
        ) : (
          <select
            id="shelf-select"
            data-testid="shelf-select"
            value={selectedShelfId}
            onChange={(e) => setSelectedShelfId(e.target.value)}
            disabled={isProcessing}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* No-key informational banner (non-blocking) */}
      {hasActiveKey === false && (
        <div
          data-testid="photo-uploader-no-key-warning"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Brak aktywnego klucza API — zdjęcie zostanie wgrane, ale analiza LLM nie zostanie
          uruchomiona.{' '}
          <a href="/account" className="font-medium underline hover:text-amber-900">
            Dodaj klucz w ustawieniach konta
          </a>
          .
        </div>
      )}

      {/* S-36: kontrola kosztu — odznaczenie pomija vision/match przy uploadzie */}
      {!isProcessing && stage !== 'done' && stage !== 'duplicate' && (
        <label className="mb-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            data-testid="auto-process-checkbox"
            checked={autoProcess}
            onChange={(e) => handleAutoProcessChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="flex items-center gap-1">
            Analizuj od razu{' '}
            <span className="text-gray-500 dark:text-gray-400">(vision + match, płatne)</span>
            <HelpTip label="auto-process">
              Zaznaczone: po wgraniu zdjęcie jest od razu analizowane przez AI (vision) i
              dopasowywane do baz książek — generuje koszt API. Odznaczone: zdjęcie zostaje
              zapisane, analizę uruchamiasz ręcznie z karty Zdjęcia.
            </HelpTip>
          </span>
        </label>
      )}

      {/* Drop zone + camera button */}
      {!isProcessing && stage !== 'done' && stage !== 'duplicate' && (
        <>
          <div
            data-testid="drop-zone"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40' : 'border-gray-300 bg-gray-50 hover:border-gray-400 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-gray-500'}`}
          >
            <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              Przeciągnij zdjęcie półki lub kliknij, by wybrać
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              JPEG, PNG, WebP — max 15 MB (serwer przetwarza oryginał)
            </p>
            <input
              ref={fileInputRef}
              data-testid="file-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInputChange}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="camera-capture-btn"
              data-camera-mode={supportsDesktopCamera ? 'desktop' : 'mobile'}
              onClick={() => {
                if (supportsDesktopCamera) {
                  setCameraOpen(true);
                } else {
                  cameraInputRef.current?.click();
                }
              }}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Zrób zdjęcie
            </button>
          </div>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="absolute -top-[9999px] -left-[9999px] h-px w-px opacity-0"
            data-testid="camera-input"
            onChange={handleFileInputChange}
          />
          {cameraOpen && (
            <CameraPreview onCapture={handleCameraCapture} onCancel={handleCameraCancel} />
          )}
        </>
      )}

      {/* Progress — przyciski zablokowane do czasu zakończenia */}
      {isProcessing && (
        <div
          data-testid="progress-area"
          className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-6 py-8 text-center dark:border-blue-900 dark:bg-blue-950/40"
        >
          <div
            className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600 dark:border-blue-900 dark:border-t-blue-400"
            aria-hidden="true"
          />
          <p className="text-base font-semibold text-blue-800 dark:text-blue-200">
            {stageLabel[stage]}
          </p>
          <p className="mt-1 text-sm text-blue-600 dark:text-blue-300">
            Poczekaj na zakończenie — kolejne zdjęcie będzie możliwe za chwilę.
          </p>
        </div>
      )}

      {/* Duplicate warning */}
      {stage === 'duplicate' && (
        <div
          data-testid="duplicate-warning"
          className="mt-4 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-4 dark:border-yellow-800 dark:bg-yellow-950/40"
        >
          <p className="mb-3 text-sm font-medium text-yellow-800 dark:text-yellow-200">
            {formattedDuplicateDate
              ? `To zdjęcie jest już w katalogu (dodane ${formattedDuplicateDate}).`
              : 'To zdjęcie zostało już wcześniej wgrane do katalogu.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {duplicatePhotoId && (
              <a
                data-testid="open-existing-link"
                href={`/photos/${duplicatePhotoId}`}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
              >
                Otwórz istniejące
              </a>
            )}
            <button
              data-testid="cancel-duplicate-button"
              onClick={handleCancelDuplicate}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && (
        <div
          data-testid="error-area"
          className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/40"
        >
          <p className="mb-2 text-sm text-red-700 dark:text-red-300">{errorMsg}</p>
          {noApiKey && (
            <div className="mb-2 flex flex-wrap gap-3">
              <a
                data-testid="no-api-key-link"
                href="/account"
                className="text-sm text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Dodaj klucz API w ustawieniach konta
              </a>
              {currentPhotoId && (
                <a
                  data-testid="uploaded-photo-link"
                  href={`/photos/${currentPhotoId}`}
                  className="text-sm text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Przejdź do wgranego zdjęcia
                </a>
              )}
            </div>
          )}
          {currentPhotoId && (
            <button
              data-testid="retry-button"
              onClick={() => void handleRetry()}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
            >
              {canRetryMatchOnly ? 'Spróbuj dopasować ponownie' : 'Spróbuj ponownie'}
            </button>
          )}
          {!currentPhotoId && (
            <button
              data-testid="retry-upload-button"
              onClick={() => {
                setStage('idle');
                setErrorMsg(null);
              }}
              className="rounded bg-gray-600 px-3 py-1 text-sm text-white hover:bg-gray-700"
            >
              Wróć
            </button>
          )}
        </div>
      )}
    </div>
  );
}
