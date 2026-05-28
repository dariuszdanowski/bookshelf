import { useCallback, useEffect, useRef, useState } from 'react';

import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';
import type { DetectionDTO, PhotoDTO } from '../lib/photos/schema';
import type { ShelfDTO } from '../lib/shelves/schema';
import Skeleton from './Skeleton';

type UploadStage = 'idle' | 'uploading' | 'recording' | 'processing' | 'done' | 'error';

type Result = {
  photo: PhotoDTO;
  detections: DetectionDTO[];
};

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB cap (photon pamięć Worker 128MB)

const SPINE_COLOR_MAP: Record<string, string> = {
  czerwony: 'bg-red-200 text-red-800',
  pomarańczowy: 'bg-orange-200 text-orange-800',
  żółty: 'bg-yellow-200 text-yellow-800',
  zielony: 'bg-green-200 text-green-800',
  niebieski: 'bg-blue-200 text-blue-800',
  granatowy: 'bg-indigo-200 text-indigo-800',
  fioletowy: 'bg-purple-200 text-purple-800',
  różowy: 'bg-pink-200 text-pink-800',
  brązowy: 'bg-amber-200 text-amber-800',
  czarny: 'bg-gray-800 text-gray-100',
  biały: 'bg-gray-100 text-gray-800',
  szary: 'bg-gray-300 text-gray-800',
};


export default function PhotoUploader({ userId }: { userId: string }) {
  const [shelves, setShelves] = useState<ShelfDTO[]>([]);
  const [selectedShelfId, setSelectedShelfId] = useState('');
  const [stage, setStage] = useState<UploadStage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
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
      const res = await fetch(`/api/photos/${photoId}/process`, { method: 'POST' });
      const json = (await res.json()) as {
        data?: { photo: PhotoDTO; detections: DetectionDTO[] };
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        throw new Error(json.error?.message ?? `Błąd przetwarzania (${res.status})`);
      }
      return json.data;
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
      setResult(null);
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

        const data = await processPhoto(photoId);
        setResult(data);
        setStage('done');
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
      const data = await processPhoto(currentPhotoId);
      setResult(data);
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

  const isProcessing = ['resizing', 'uploading', 'recording', 'processing'].includes(stage);

  const stageLabel: Record<UploadStage, string> = {
    idle: '',
    uploading: 'Wgrywanie do Storage...',
    recording: 'Zapisywanie rekordu...',
    processing: 'Analiza vision (może zająć ~10s)...',
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

      {/* Results */}
      {stage === 'done' && result && (
        <div data-testid="results-area" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Wykryte książki ({result.detections.length})
            </h2>
            <button
              data-testid="scan-another-button"
              onClick={() => { setStage('idle'); setResult(null); setCurrentPhotoId(null); }}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            >
              Skanuj kolejne
            </button>
          </div>
          {result.detections.length === 0 ? (
            <p className="text-sm text-gray-600">Nie wykryto żadnych książek na zdjęciu.</p>
          ) : (
            <ul className="space-y-2" data-testid="detections-list">
              {result.detections.map((d, i) => (
                <li
                  key={i}
                  data-testid={`detection-item-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
                >
                  <span className="mt-0.5 text-xs text-gray-400">#{d.position_index}</span>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{d.raw_title}</p>
                    {d.raw_author && (
                      <p className="text-sm text-gray-600">{d.raw_author}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {d.vision_confidence != null && (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {Math.round(d.vision_confidence * 100)}%
                        </span>
                      )}
                      {d.spine_color && (
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${SPINE_COLOR_MAP[d.spine_color] ?? 'bg-gray-100 text-gray-700'}`}
                        >
                          {d.spine_color}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.photo.vision_cost_usd != null && (
            <p className="mt-3 text-xs text-gray-400">
              Koszt vision: ${result.photo.vision_cost_usd.toFixed(4)} &bull;{' '}
              {result.photo.vision_latency_ms != null
                ? `${(result.photo.vision_latency_ms / 1000).toFixed(1)}s`
                : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
