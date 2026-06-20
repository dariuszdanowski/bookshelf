import { useEffect, useRef } from 'react';

import { useBodyScrollLock } from './useBodyScrollLock';

type Step = {
  label: string;
  status: 'pending' | 'active' | 'done';
};

type Props = {
  open: boolean;
  label: string;
  steps?: Step[];
  titles?: string[];
  progress?: { current: number; total: number };
  stats?: { matched: number; unmatched: number } | null;
  currentItem?: { title: string; authors?: string[]; matched?: boolean } | null;
};

function StepIcon({ status }: { status: Step['status'] }) {
  if (status === 'done') {
    return (
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-600">
        ✓
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
        <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-200" />
  );
}

export default function ProgressModal({
  open,
  label,
  steps,
  titles,
  progress,
  stats,
  currentItem,
}: Props) {
  useBodyScrollLock(open);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [titles?.length]);

  if (!open) return null;

  const isDeterminate = progress != null && progress.total > 0;
  const pct = isDeterminate ? Math.round((progress.current / progress.total) * 100) : 0;

  const activeStep = steps?.find((s) => s.status === 'active');
  const showProgress = !steps || activeStep?.label === steps[steps.length - 1]?.label;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Przetwarzanie..."
        data-testid="progress-modal"
        className="w-full max-w-sm rounded-xl bg-white p-8 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <svg
            viewBox="0 0 72 72"
            width="56"
            height="56"
            aria-hidden="true"
            className="flex-shrink-0 overflow-visible"
          >
            <style>{`
              @keyframes lupa-fly {
                0%,100%{transform:translate(0,0) rotate(-14deg);}
                30%{transform:translate(6px,-12px) rotate(10deg);}
                70%{transform:translate(-4px,-6px) rotate(-6deg);}
              }
              @keyframes lupa-twinkle1 {
                0%,100%{opacity:0;transform:scale(0.3);}
                40%{opacity:1;transform:scale(1);}
              }
              @keyframes lupa-twinkle2 {
                0%,100%{opacity:0;transform:scale(0.3);}
                60%{opacity:1;transform:scale(1);}
              }
              @keyframes lupa-twinkle3 {
                0%,100%{opacity:0;transform:scale(0.3);}
                50%{opacity:1;transform:scale(1);}
              }
              @keyframes lupa-trail {
                0%,100%{opacity:0;}
                40%,60%{opacity:0.35;}
              }
              .lupa-body{animation:lupa-fly 1.6s ease-in-out infinite;transform-origin:32px 32px;}
              .lupa-s1{animation:lupa-twinkle1 1.6s 0s ease-in-out infinite;transform-origin:12px 10px;}
              .lupa-s2{animation:lupa-twinkle2 1.6s 0.4s ease-in-out infinite;transform-origin:62px 18px;}
              .lupa-s3{animation:lupa-twinkle3 1.6s 0.8s ease-in-out infinite;transform-origin:18px 60px;}
              .lupa-trail{animation:lupa-trail 1.6s ease-in-out infinite;}
            `}</style>
            <g className="lupa-trail">
              <line
                x1="10"
                y1="38"
                x2="24"
                y2="36"
                stroke="#BFDBFE"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <line
                x1="8"
                y1="44"
                x2="20"
                y2="42"
                stroke="#BFDBFE"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
            <g className="lupa-body">
              <circle
                cx="32"
                cy="30"
                r="16"
                fill="#EFF6FF"
                stroke="#3B82F6"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <circle
                cx="27"
                cy="25"
                r="6"
                fill="none"
                stroke="#BFDBFE"
                strokeWidth="2"
                opacity="0.8"
              />
              <line
                x1="44"
                y1="42"
                x2="56"
                y2="54"
                stroke="#2563EB"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </g>
            <g className="lupa-s1">
              <polygon
                points="12,6 13.2,9.6 17,10 13.8,12.6 14.8,16.4 12,14 9.2,16.4 10.2,12.6 7,10 10.8,9.6"
                fill="#FCD34D"
              />
            </g>
            <g className="lupa-s2">
              <circle cx="62" cy="18" r="3" fill="#A78BFA" />
            </g>
            <g className="lupa-s3">
              <circle cx="18" cy="60" r="2.5" fill="#34D399" />
            </g>
          </svg>

          <p
            data-testid="progress-modal-label"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {label}
          </p>

          {/* Step list */}
          {steps && steps.length > 0 && (
            <ol className="w-full space-y-2 text-left">
              {steps.map((step, i) => (
                <li key={i} className="flex items-center gap-3">
                  <StepIcon status={step.status} />
                  <span
                    className={`text-sm ${
                      step.status === 'active'
                        ? 'font-medium text-blue-600 dark:text-blue-400'
                        : step.status === 'done'
                          ? 'text-gray-400 line-through dark:text-gray-500'
                          : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* Progress bar — only shown for the last (match) step */}
          {showProgress && (
            <>
              <div
                data-testid="progress-modal-bar"
                className={`relative h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 ${!isDeterminate ? 'animate-pulse' : ''}`}
              >
                {isDeterminate && (
                  <div
                    role="progressbar"
                    aria-valuenow={progress.current}
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>

              {isDeterminate ? (
                <p
                  data-testid="progress-modal-counter"
                  className="text-xs text-gray-500 dark:text-gray-400"
                >
                  {progress.current} / {progress.total} przetworzonych
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Poczekaj — to zajmie chwilę
                </p>
              )}

              {/* Matched / unmatched stats */}
              {stats != null && (
                <p data-testid="progress-modal-stats" className="flex gap-3 text-xs">
                  <span className="text-green-600">&#x2713; {stats.matched} dopasowanych</span>
                  <span className="text-gray-400">&#x2715; {stats.unmatched} niedopasowanych</span>
                </p>
              )}

              {/* Current item */}
              {currentItem != null && (
                <div
                  data-testid="progress-modal-current-item"
                  className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-left dark:border-gray-700 dark:bg-gray-700/50"
                >
                  <div className="flex items-start gap-2">
                    {currentItem.matched != null && (
                      <span
                        className={`mt-0.5 flex-shrink-0 text-xs font-bold ${currentItem.matched ? 'text-green-500' : 'text-gray-400'}`}
                        aria-hidden="true"
                      >
                        {currentItem.matched ? '✓' : '✗'}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                        {currentItem.title}
                      </p>
                      {currentItem.authors && currentItem.authors.length > 0 && (
                        <p className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                          {currentItem.authors.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Scrollable titles list (legacy / fallback) */}
              {!currentItem && titles && titles.length > 0 && (
                <ul
                  ref={listRef}
                  data-testid="progress-modal-titles"
                  className="max-h-40 w-full overflow-y-auto text-left"
                >
                  {titles.map((t, i) => (
                    <li
                      key={i}
                      className="truncate py-0.5 text-xs text-gray-600 dark:text-gray-400"
                      title={t}
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
