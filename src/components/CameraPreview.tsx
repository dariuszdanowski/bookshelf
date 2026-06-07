import { useEffect, useRef, useState } from 'react';

interface CameraPreviewProps {
  onCapture: (file: File) => void;
  onCancel: () => void;
}

type CameraError = 'permission' | 'unavailable' | null;

export default function CameraPreview({ onCapture, onCancel }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Fix impl-review F7: unmount/cancel przed resolve toBlob nie może już
  // wywołać onCapture (upload mimo Anuluj); capturing blokuje double-click.
  const unmountedRef = useRef(false);
  const [error, setError] = useState<CameraError>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    unmountedRef.current = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // setReady via onLoadedMetadata — gwarantuje non-zero videoWidth/Height przy capture
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : '';
        setError(
          name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? 'permission'
            : 'unavailable',
        );
      });

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || capturing) return;
    setCapturing(true);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        // Anuluj/unmount w trakcie toBlob → nie startuj uploadu.
        if (unmountedRef.current) return;
        if (!blob) {
          setCapturing(false);
          setError('unavailable');
          return;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        onCapture(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.85,
    );
  }

  return (
    <div
      data-testid="camera-preview"
      className="mt-3 overflow-hidden rounded-xl border border-gray-300 dark:border-gray-600"
    >
      {error ? (
        <div
          data-testid="camera-preview-error"
          className="px-4 py-6 text-sm text-gray-700 dark:text-gray-300"
        >
          {error === 'permission' ? (
            <p>
              Brak dostępu do kamery — sprawdź uprawnienia przeglądarki lub użyj przycisku{' '}
              <strong>Wybierz plik</strong>.
            </p>
          ) : (
            <p>
              Kamera niedostępna. Spróbuj użyć przycisku <strong>Wybierz plik</strong>.
            </p>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Zamknij
          </button>
        </div>
      ) : (
        <>
          <div className="relative bg-black">
            <video
              ref={videoRef}
              data-testid="camera-preview-video"
              autoPlay
              muted
              playsInline
              onLoadedMetadata={() => setReady(true)}
              className="w-full"
            />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-white">Uruchamianie kamery...</p>
              </div>
            )}
          </div>
          <div className="flex gap-2 p-3">
            <button
              type="button"
              data-testid="camera-preview-take"
              disabled={!ready || capturing}
              onClick={capture}
              className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Zrób zdjęcie
            </button>
            <button
              type="button"
              data-testid="camera-preview-cancel"
              onClick={onCancel}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Anuluj
            </button>
          </div>
        </>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
