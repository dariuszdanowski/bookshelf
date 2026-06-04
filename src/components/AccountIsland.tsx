import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { ChangePasswordSchema, UpdateProfileSchema } from '../lib/account/schema';
import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';

type StatsData = {
  total_vision_cost_usd: number;
  total_refine_cost_usd: number;
  vision_run_count: number;
  refine_call_count: number;
};

interface Props {
  initialDisplayName: string | null;
  userEmail: string;
}

function formatUsd(val: number): string {
  if (val === 0) return '$0.0000';
  if (val < 0.01) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

export default function AccountIsland({ initialDisplayName, userEmail }: Props) {
  // Display name
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const savedDisplayNameRef = useRef(initialDisplayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Email change
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);

  // Password change
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordFieldError, setPasswordFieldError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Stats
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/stats')
      .then(
        (r) =>
          r.json() as Promise<
            { data: StatsData } | { error: { code: string; message: string } }
          >
      )
      .then((json) => {
        if (cancelled) return;
        if ('data' in json) setStats(json.data);
        else setStatsError('Nie udało się pobrać statystyk.');
      })
      .catch(() => {
        if (!cancelled) setStatsError('Nie udało się pobrać statystyk.');
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveDisplayName() {
    const parsed = UpdateProfileSchema.safeParse({ display_name: displayName });
    if (!parsed.success) {
      setSaveError('Nazwa wyświetlana nie może być pusta ani przekraczać 100 znaków.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: parsed.data.display_name }),
      });

      type ProfileOk = { data: { profile: { id: string; display_name: string | null } } };
      type ProfileErr = { error: { code: string; message: string } };
      const json = (await res.json()) as ProfileOk | ProfileErr;

      if (res.ok && 'data' in json) {
        const newVal = json.data.profile.display_name ?? '';
        savedDisplayNameRef.current = newVal;
        setDisplayName(newVal);
        setSaveSuccess(true);
      } else {
        setDisplayName(savedDisplayNameRef.current);
        const failure = json as ProfileErr;
        setSaveError(failure.error?.message ?? 'Nie udało się zapisać nazwy.');
      }
    } catch {
      setDisplayName(savedDisplayNameRef.current);
      setSaveError('Błąd sieci. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  }

  async function handleChangeEmail() {
    const parsed = z.email().safeParse(newEmail);
    if (!parsed.success) {
      setEmailError('Podaj prawidłowy adres email.');
      return;
    }

    setEmailLoading(true);
    setEmailError(null);
    setEmailPending(false);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.updateUser({ email: parsed.data });
      if (error) {
        setEmailError(error.message);
      } else {
        setEmailPending(true);
        setNewEmail('');
      }
    } catch {
      setEmailError('Błąd sieci. Spróbuj ponownie.');
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleChangePassword() {
    const parsed = ChangePasswordSchema.safeParse({
      password: newPassword,
      confirm: confirmPassword,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      setPasswordFieldError(
        flat.fieldErrors.confirm?.[0] ?? flat.fieldErrors.password?.[0] ?? 'Błąd walidacji.'
      );
      return;
    }

    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordFieldError(null);
    setPasswordSuccess(false);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (error) {
        setPasswordError(error.message);
      } else {
        setPasswordSuccess(true);
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setPasswordError('Błąd sieci. Spróbuj ponownie.');
    } finally {
      setPasswordLoading(false);
    }
  }

  const inputCls =
    'block w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
  const inputDisabledCls =
    'mt-1 block w-full rounded border border-gray-300 bg-gray-50 px-3 py-2 text-gray-900 opacity-70 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300';
  const sectionBoxCls = 'space-y-4 rounded border border-gray-200 p-4 dark:border-gray-600';

  return (
    <div className="space-y-8">
      {/* Sekcja: Profil */}
      <section data-testid="account-profile-section">
        <h2 className="mb-4 text-xl font-semibold">Profil</h2>
        <div className={sectionBoxCls}>
          <div>
            <label htmlFor="display_name" className="block text-sm font-medium">
              Nazwa wyświetlana
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="display_name"
                name="display_name"
                type="text"
                maxLength={100}
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setSaveSuccess(false);
                  setSaveError(null);
                }}
                className={inputCls}
                data-testid="account-display-name-input"
              />
              <button
                onClick={handleSaveDisplayName}
                disabled={saving}
                className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                data-testid="account-display-name-save"
              >
                {saving ? 'Zapisuję...' : 'Zapisz'}
              </button>
            </div>
            {saveError && (
              <p className="mt-1 text-sm text-red-600" data-testid="account-display-name-error">
                {saveError}
              </p>
            )}
            {saveSuccess && (
              <p className="mt-1 text-sm text-green-600" data-testid="account-display-name-success">
                Nazwa zapisana.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Sekcja: Email */}
      <section data-testid="account-email-section">
        <h2 className="mb-4 text-xl font-semibold">Email</h2>
        <div className={sectionBoxCls}>
          <div>
            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
              Aktualny email
            </label>
            <input
              type="email"
              value={userEmail}
              readOnly
              disabled
              className={inputDisabledCls}
              data-testid="account-email-input"
            />
          </div>
          <div>
            <label htmlFor="new_email" className="block text-sm font-medium">
              Nowy adres email
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="new_email"
                name="new_email"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  setEmailError(null);
                  setEmailPending(false);
                }}
                className={inputCls}
                data-testid="account-new-email-input"
              />
              <button
                onClick={handleChangeEmail}
                disabled={emailLoading}
                className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                data-testid="account-email-save"
              >
                {emailLoading ? 'Wysyłam...' : 'Zmień email'}
              </button>
            </div>
            {emailError && (
              <p className="mt-1 text-sm text-red-600" data-testid="account-email-error">
                {emailError}
              </p>
            )}
            {emailPending && (
              <p className="mt-1 text-sm text-green-600" data-testid="account-email-pending">
                Email zaktualizowany. Jeśli włączone potwierdzenie, sprawdź skrzynkę.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Sekcja: Hasło */}
      <section data-testid="account-password-section">
        <h2 className="mb-4 text-xl font-semibold">Hasło</h2>
        <div className={sectionBoxCls}>
          <div>
            <label htmlFor="account_new_password" className="block text-sm font-medium">
              Nowe hasło
            </label>
            <input
              id="account_new_password"
              name="account_new_password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordFieldError(null);
                setPasswordError(null);
                setPasswordSuccess(false);
              }}
              className={`mt-1 ${inputCls}`}
              data-testid="account-new-password-input"
            />
          </div>
          <div>
            <label htmlFor="account_confirm_password" className="block text-sm font-medium">
              Powtórz hasło
            </label>
            <input
              id="account_confirm_password"
              name="account_confirm_password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordFieldError(null);
              }}
              className={`mt-1 ${inputCls}`}
              data-testid="account-confirm-password-input"
            />
          </div>
          {passwordFieldError && (
            <p className="text-sm text-red-600" data-testid="account-password-field-error">
              {passwordFieldError}
            </p>
          )}
          {passwordError && (
            <p className="text-sm text-red-600" data-testid="account-password-error">
              {passwordError}
            </p>
          )}
          {passwordSuccess && (
            <p className="text-sm text-green-600" data-testid="account-password-success">
              Hasło zostało zmienione.
            </p>
          )}
          <button
            onClick={handleChangePassword}
            disabled={passwordLoading}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            data-testid="account-password-save"
          >
            {passwordLoading ? 'Zapisuję...' : 'Zmień hasło'}
          </button>
        </div>
      </section>

      {/* Sekcja: Koszty analizy */}
      <section data-testid="account-stats-section">
        <h2 className="mb-4 text-xl font-semibold">Koszty analizy</h2>
        <div className="rounded border border-gray-200 p-4 dark:border-gray-600">
          {statsLoading && (
            <p className="text-sm text-gray-500" data-testid="account-stats-loading">
              Ładuję...
            </p>
          )}
          {statsError && (
            <p className="text-sm text-red-600" data-testid="account-stats-error">
              {statsError}
            </p>
          )}
          {stats && (
            <div className="space-y-2" data-testid="account-stats-content">
              <div className="text-2xl font-bold" data-testid="account-stats-total">
                {formatUsd(stats.total_vision_cost_usd + stats.total_refine_cost_usd)}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm text-gray-700 dark:text-gray-300">
                <div>
                  <span className="font-medium">Vision:</span>{' '}
                  {formatUsd(stats.total_vision_cost_usd)} ({stats.vision_run_count} analiz)
                </div>
                <div>
                  <span className="font-medium">Refine:</span>{' '}
                  {formatUsd(stats.total_refine_cost_usd)} ({stats.refine_call_count} wywołań)
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Sekcja: Klucze API — placeholder, S-32 zastąpi */}
      <section data-testid="account-keys-placeholder">
        <h2 className="mb-4 text-xl font-semibold">Klucze API</h2>
        <div className="rounded border border-gray-200 p-4 dark:border-gray-600">
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            Używaj własnych kluczy API (BYOK) — konfiguracja dostępna wkrótce.
          </p>
          <button
            disabled
            className="cursor-not-allowed rounded bg-gray-200 px-4 py-2 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-400"
          >
            Dodaj klucz (wkrótce)
          </button>
        </div>
      </section>
    </div>
  );
}
