import { useEffect, useState } from 'react';

import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';

const STORAGE_KEY = '__bookshelf_impersonation';

interface ImpersonationState {
  admin_access_token: string;
  admin_refresh_token: string;
  impersonated_email: string;
}

export default function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as ImpersonationState);
    } catch {
      // ignore parse errors
    }
  }, []);

  if (!state) return null;

  async function handleReturn() {
    if (returning || !state) return;
    setReturning(true);
    try {
      const supabase = createBrowserSupabaseClient();
      await supabase.auth.setSession({
        access_token: state.admin_access_token,
        refresh_token: state.admin_refresh_token,
      });
      localStorage.removeItem(STORAGE_KEY);
      window.location.href = '/admin';
    } catch {
      setReturning(false);
    }
  }

  return (
    <div
      role="alert"
      data-testid="impersonation-banner"
      className="flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 dark:bg-amber-600 dark:text-amber-50"
    >
      <span>
        Tryb impersonacji — przeglądasz konto:{' '}
        <strong data-testid="impersonation-email">{state.impersonated_email}</strong>
      </span>
      <button
        type="button"
        onClick={handleReturn}
        disabled={returning}
        data-testid="impersonation-return-btn"
        className="rounded bg-amber-800/20 px-3 py-1 text-xs font-semibold hover:bg-amber-800/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {returning ? '…' : 'Wróć do własnego konta'}
      </button>
    </div>
  );
}
