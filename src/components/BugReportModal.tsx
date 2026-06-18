import { useEffect, useState } from 'react';

import { useBodyScrollLock } from './useBodyScrollLock';

export default function BugReportModal() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [issueNumber, setIssueNumber] = useState<number | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState('');

  useBodyScrollLock(open);

  useEffect(() => {
    setCurrentUrl(window.location.href);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function closeModal() {
    setOpen(false);
    setError(null);
    setSuccess(false);
    setIssueNumber(null);
    setIssueUrl(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const title = (data.get('title') as string).trim();
    const description = (data.get('description') as string).trim();
    const url = (data.get('url') as string).trim();

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, url: url || undefined }),
      });

      const json = (await res.json()) as {
        data?: { issueNumber: number; issueUrl: string };
        error?: { message: string };
      };

      if (!res.ok) {
        setError(json.error?.message ?? 'Wystąpił błąd. Spróbuj ponownie.');
        return;
      }

      setIssueNumber(json.data!.issueNumber);
      setIssueUrl(json.data!.issueUrl);
      setSuccess(true);
      setTimeout(() => closeModal(), 2500);
    } catch {
      setError('Nie udało się połączyć z serwerem.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="bug-report-trigger"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 dark:bg-rose-500 dark:hover:bg-rose-400"
        aria-label="Zgłoś błąd"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span className="hidden sm:inline">Zgłoś błąd</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
          data-testid="bug-report-modal"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bug-report-title"
            className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            {success ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-green-600 dark:text-green-400"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Zgłoszenie zostało wysłane
                </p>
                {issueNumber !== null && issueUrl && (
                  <a
                    href={issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400"
                  >
                    Zgłoszenie #{issueNumber} →
                  </a>
                )}
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2
                    id="bug-report-title"
                    className="text-base font-semibold text-gray-900 dark:text-gray-100"
                  >
                    Zgłoś błąd
                  </h2>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-md p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    aria-label="Zamknij"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>

                <form
                  onSubmit={handleSubmit}
                  data-testid="bug-report-form"
                  className="flex flex-col gap-4"
                >
                  <div>
                    <label
                      htmlFor="bug-title"
                      className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      Tytuł <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="bug-title"
                      name="title"
                      type="text"
                      required
                      maxLength={200}
                      placeholder="Krótki opis problemu"
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="bug-description"
                      className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      Opis <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      id="bug-description"
                      name="description"
                      required
                      maxLength={2000}
                      rows={4}
                      placeholder="Co się stało? Jak odtworzyć problem?"
                      className="h-28 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="bug-url"
                      className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      URL strony
                    </label>
                    <input
                      id="bug-url"
                      name="url"
                      type="text"
                      maxLength={500}
                      value={currentUrl}
                      onChange={(e) => setCurrentUrl(e.target.value)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
                    />
                  </div>

                  {error && (
                    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      {error}
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={submitting}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      data-testid="bug-report-submit"
                      disabled={submitting}
                      className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 dark:bg-rose-500 dark:hover:bg-rose-400"
                    >
                      {submitting ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
