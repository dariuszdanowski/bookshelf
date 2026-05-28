import { useCallback, useEffect, useRef, useState } from 'react';

import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';
import type { PhotoDTO } from '../lib/photos/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import Skeleton from './Skeleton';

type UploadStage = 'idle' | 'uploading' | 'recording' | 'processing' | 'matching' | 'done' | 'error';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB cap (photon pamięć Worker 128MB)

export default function PhotoUploader({ userId }: { userId: string }) {
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState('');
  const [stage, setStage] = useState<UploadStage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentPhotoId, setCurrentPhotoId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [shelvesError, setShelvesError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Wzorzec jak ShelvesIsland: sprawdź res.ok i zasurfuj envelope error
    // (inaczej selektor utyka na „Ładowanie półek..." w nieskończoność).
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
        if (list.length > 0) setSelectedShelfId(list[0].id);
      } catch (err) {
        setShelvesError(err instanceof Error ? err.message : 'Nie udało się pobrać półek.');
      }
    })();
  }, []);

  const processPhoto = useCallback(
    async (photoId: string) => {
      setStage('processing');
      const processRes = await fetch(`/api/photos/${photoId}/process`, { method: 'POST' });
      const processJson = (await processRes.json()) as {
        data?: { photo: PhotoDTO; detections: unknown[] };
        error?: { message?: string };
      };
      if (!processRes.ok || !processJson.data) {
        throw new Error(processJson.error?.message ?? `Błąd przetwarzania (${processRes.status})`);
      }

      setStage('matching');
      const matchRes = await fetch(`/api/photos/${photoId}/match`, { method: 'POST' });
      const matchJson = (await matchRes.json()) as {
        data?: unknown;
        error?: { message?: string };
      };
      if (!matchRes.ok || !matchJson.data) {
        throw new Error(matchJson.error?.message ?? `Błąd matchowania (${matchRes.status})`);
      }

      window.location.href = `/photos/${photoId}`;
    },
    []
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!selectedShelfId) {
        setErrorMsg('Wybierz półkę przed uploadem.');
        return;
      }
      setErrorMsg(null);
      setCurrentPhotoId(null);

      try {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error(`Plik jest za duży (max 15 MB). Wybierz mniejsze zdjęcie.`);
        }

        setStage('uploading');
        const supabase = createBrowserSupabaseClient();
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('shelf-photos')
          .upload(storagePath, file, { contentType: file.type || 'image/jpeg', upsert: false });
        if (upErr) throw new Error(upErr.message);

        setStage('recording');
        const recRes = await fetch('/api/photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shelf_id: selectedShelfId, storage_path: storagePath }),
        });
        const recJson = (await recRes.json()) as {
          data?: { photo: PhotoDTO };
          error?: { message?: string };
        };
        if (!recRes.ok || !recJson.data) {
          throw new Error(recJson.error?.message ?? `Błąd zapisu (${recRes.status})`);
        }
        const photoId = recJson.data.photo.id;
        setCurrentPhotoId(photoId);

        await processPhoto(photoId);
        setStage('done'); // redirect happens inside processPhoto; this line is reached only in tests
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Nieznany błąd');
        setStage('error');
      }
    },
    [selectedShelfId, userId, processPhoto]
  );

  const handleRetry = useCallback(async () => {
    if (!currentPhotoId) return;
    setErrorMsg(null);
    try {
      await processPhoto(currentPhotoId);
      setStage('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Nieznany błąd');
      setStage('error');
    }
  }, [currentPhotoId, processPhoto]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
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
  };

  return (
    <div data-testid="photo-uploader">
      {/* Shelf selector */}
      <div className="mb-4">
        <label htmlFor="shelf-select" className="mb-1 block text-sm font-medium text-gray-700">
          Półka
        </label>
        {shelvesError ? (
          <p
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
            data-testid="shelves-error"
          >
            {shelvesError}
          </p>
        ) : shelves.length === 0 ? (
          <p className="text-sm text-gray-500">Ładowanie półek...</p>
        ) : (
          <select
            id="shelf-select"
            data-testid="shelf-select"
            value={selectedShelfId}
            onChange={(e) => setSelectedShelfId(e.target.value)}
            disabled={isProcessing}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Drop zone */}
      {!isProcessing && stage !== 'done' && (
        <div
          data-testid="drop-zone"
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${isDragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'}`}
        >
          <p className="mb-2 text-sm font-medium text-gray-700">
            Przeciągnij zdjęcie półki lub kliknij, by wybrać
          </p>
          <p className="text-xs text-gray-500">JPEG, PNG, WebP — max 15 MB (serwer przetwarza oryginał)</p>
          <input
            ref={fileInputRef}
            data-testid="file-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {/* Progress */}
      {isProcessing && (
        <div data-testid="progress-area" className="mt-4 space-y-3">
          <Skeleton className="h-4 w-3/4" aria-label={stageLabel[stage]} />
          <Skeleton className="h-4 w-1/2" />
          <p className="text-sm text-gray-600">{stageLabel[stage]}</p>
        </div>
      )}

      {/* Error */}
      {stage === 'error' && (
        <div
          data-testid="error-area"
          className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3"
        >
          <p className="mb-2 text-sm text-red-700">{errorMsg}</p>
          {currentPhotoId && (
            <button
              data-testid="retry-button"
              onClick={() => void handleRetry()}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
            >
              Spróbuj ponownie
            </button>
          )}
          {!currentPhotoId && (
            <button
              data-testid="retry-upload-button"
              onClick={() => { setStage('idle'); setErrorMsg(null); }}
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
