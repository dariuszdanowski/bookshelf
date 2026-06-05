import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { ChangePasswordSchema, UpdateProfileSchema } from '../lib/account/schema';
import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';
import type { ApiKeyDTO, CreateKeyInput } from '../lib/keys/schema';

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

  // API Keys (S-32)
  const [keys, setKeys] = useState<ApiKeyDTO[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<CreateKeyInput>({ label: '', provider: 'anthropic', key_value: '' });
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ label: string; provider: CreateKeyInput['provider']; model: string; base_url: string; key_value: string }>({ label: '', provider: 'anthropic', model: '', base_url: '', key_value: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/keys')
      .then((r) => r.json() as Promise<{ data: { keys: ApiKeyDTO[] } } | { error: unknown }>)
      .then((json) => {
        if (cancelled) return;
        if ('data' in json) setKeys(json.data.keys ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setKeysLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleAddKey() {
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch('/api/account/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      type KeyOk = { data: { key: ApiKeyDTO } };
      type KeyErr = { error: { message: string } };
      const json = (await res.json()) as KeyOk | KeyErr;
      if (res.ok && 'data' in json) {
        setKeys((prev) => [...prev, json.data.key]);
        setAddOpen(false);
        setAddForm({ label: '', provider: 'anthropic', key_value: '' });
      } else {
        const err = json as KeyErr;
        setAddError(err.error?.message ?? 'Nie udało się dodać klucza.');
      }
    } catch {
      setAddError('Błąd sieci. Spróbuj ponownie.');
    } finally {
      setAddLoading(false);
    }
  }

  async function handleTestKey(id: string) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/account/keys/${id}/test`, { method: 'POST' });
      const json = (await res.json()) as { data: { result: 'ok' | 'error' } };
      if (res.ok) {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === id
              ? { ...k, last_test_result: json.data.result, last_tested_at: new Date().toISOString() }
              : k
          )
        );
      }
    } catch {
      // silent — wynik testu pokazany w ostatnim_test_result
    } finally {
      setTestingId(null);
    }
  }

  async function handleActivateKey(id: string) {
    setActivatingId(id);
    try {
      const res = await fetch(`/api/account/keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => ({ ...k, is_active: k.id === id })));
      }
    } catch {
      // silent
    } finally {
      setActivatingId(null);
    }
  }

  async function handleDeactivateKey(id: string) {
    setDeactivatingId(id);
    try {
      const res = await fetch(`/api/account/keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (res.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, is_active: false } : k)));
      }
    } catch {
      // silent
    } finally {
      setDeactivatingId(null);
    }
  }

  async function handleDeleteKey(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/account/keys/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== id));
      }
    } catch {
      // silent
    } finally {
      setDeletingId(null);
    }
  }

  function openEdit(key: ApiKeyDTO) {
    setEditingId(key.id);
    setEditForm({ label: key.label, provider: key.provider, model: key.model ?? '', base_url: key.base_url ?? '', key_value: '' });
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    setEditLoading(true);
    setEditError(null);
    const body: Record<string, unknown> = { label: editForm.label, provider: editForm.provider };
    body.model = editForm.model || null;
    body.base_url = editForm.base_url || null;
    if (editForm.key_value) body.key_value = editForm.key_value;
    try {
      const res = await fetch(`/api/account/keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      type KeyOk = { data: { key: ApiKeyDTO } };
      type KeyErr = { error: { message: string } };
      const json = (await res.json()) as KeyOk | KeyErr;
      if (res.ok && 'data' in json) {
        setKeys((prev) => prev.map((k) => (k.id === id ? json.data.key : k)));
        setEditingId(null);
      } else {
        const err = json as KeyErr;
        setEditError(err.error?.message ?? 'Nie udało się zapisać.');
      }
    } catch {
      setEditError('Błąd sieci. Spróbuj ponownie.');
    } finally {
      setEditLoading(false);
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

      {/* Sekcja: Klucze API */}
      <section data-testid="account-keys-section">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Klucze API</h2>
          {!addOpen && (
            <button
              onClick={() => setAddOpen(true)}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              data-testid="account-keys-add-btn"
            >
              Dodaj klucz
            </button>
          )}
        </div>

        {addOpen && (
          <div className={`mb-4 ${sectionBoxCls}`} data-testid="account-keys-add-form">
            <h3 className="font-medium">Nowy klucz API</h3>
            <div>
              <label htmlFor="key_label" className="block text-sm font-medium">
                Etykieta
              </label>
              <input
                id="key_label"
                type="text"
                maxLength={100}
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                className={`mt-1 ${inputCls}`}
                placeholder="np. Mój klucz Anthropic"
                data-testid="account-keys-label-input"
              />
            </div>
            <div>
              <label htmlFor="key_provider" className="block text-sm font-medium">
                Dostawca
              </label>
              <select
                id="key_provider"
                value={addForm.provider}
                onChange={(e) =>
                  setAddForm((f) => ({
                    ...f,
                    provider: e.target.value as CreateKeyInput['provider'],
                    base_url: e.target.value !== 'openai_compatible' ? undefined : f.base_url,
                  }))
                }
                className={`mt-1 ${inputCls}`}
                data-testid="account-keys-provider-select"
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="openai_compatible">OpenAI-compatible</option>
              </select>
            </div>
            {addForm.provider === 'openai_compatible' && (
              <div>
                <label htmlFor="key_base_url" className="block text-sm font-medium">
                  Base URL
                </label>
                <input
                  id="key_base_url"
                  type="url"
                  value={addForm.base_url ?? ''}
                  onChange={(e) => setAddForm((f) => ({ ...f, base_url: e.target.value || undefined }))}
                  className={`mt-1 ${inputCls}`}
                  placeholder="https://api.example.com/v1"
                  data-testid="account-keys-base-url-input"
                />
              </div>
            )}
            <div>
              <label htmlFor="key_model" className="block text-sm font-medium">
                Model (opcjonalnie)
              </label>
              <input
                id="key_model"
                type="text"
                maxLength={100}
                value={addForm.model ?? ''}
                onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value || undefined }))}
                className={`mt-1 ${inputCls}`}
                placeholder="np. claude-3-5-sonnet-20241022"
                data-testid="account-keys-model-input"
              />
            </div>
            <div>
              <label htmlFor="key_value" className="block text-sm font-medium">
                Klucz API
              </label>
              <input
                id="key_value"
                type="password"
                autoComplete="off"
                value={addForm.key_value}
                onChange={(e) => setAddForm((f) => ({ ...f, key_value: e.target.value }))}
                className={`mt-1 ${inputCls}`}
                placeholder="sk-..."
                data-testid="account-keys-value-input"
              />
            </div>
            {addError && (
              <p className="text-sm text-red-600" data-testid="account-keys-add-error">
                {addError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleAddKey}
                disabled={addLoading}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                data-testid="account-keys-add-submit"
              >
                {addLoading ? 'Zapisuję...' : 'Zapisz klucz'}
              </button>
              <button
                onClick={() => {
                  setAddOpen(false);
                  setAddError(null);
                  setAddForm({ label: '', provider: 'anthropic', key_value: '' });
                }}
                className="rounded border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
                data-testid="account-keys-add-cancel"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}

        <div className={sectionBoxCls} data-testid="account-keys-list">
          {keysLoading && (
            <p className="text-sm text-gray-500" data-testid="account-keys-loading">
              Ładuję...
            </p>
          )}
          {!keysLoading && keys.length === 0 && (
            <p className="text-sm text-gray-500" data-testid="account-keys-empty">
              Brak skonfigurowanych kluczy. Dodaj własny klucz API (BYOK), aby korzystać z modeli AI.
            </p>
          )}
          {keys.map((key) => (
            <div
              key={key.id}
              className="rounded border border-gray-200 p-3 dark:border-gray-700"
              data-testid={`account-key-row-${key.id}`}
            >
              {editingId === key.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium">Etykieta</label>
                    <input
                      type="text"
                      maxLength={100}
                      value={editForm.label}
                      onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                      className={`mt-1 ${inputCls}`}
                      data-testid={`account-key-edit-label-${key.id}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Dostawca</label>
                    <select
                      value={editForm.provider}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          provider: e.target.value as CreateKeyInput['provider'],
                          base_url: e.target.value !== 'openai_compatible' ? '' : f.base_url,
                        }))
                      }
                      className={`mt-1 ${inputCls}`}
                      data-testid={`account-key-edit-provider-${key.id}`}
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai_compatible">OpenAI-compatible</option>
                    </select>
                  </div>
                  {editForm.provider === 'openai_compatible' && (
                    <div>
                      <label className="block text-sm font-medium">Base URL</label>
                      <input
                        type="url"
                        value={editForm.base_url}
                        onChange={(e) => setEditForm((f) => ({ ...f, base_url: e.target.value }))}
                        className={`mt-1 ${inputCls}`}
                        placeholder="https://api.example.com/v1"
                        data-testid={`account-key-edit-base-url-${key.id}`}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium">Model (opcjonalnie)</label>
                    <input
                      type="text"
                      maxLength={100}
                      value={editForm.model}
                      onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                      className={`mt-1 ${inputCls}`}
                      placeholder="np. claude-3-5-sonnet-20241022"
                      data-testid={`account-key-edit-model-${key.id}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Nowy klucz API (opcjonalnie)</label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={editForm.key_value}
                      onChange={(e) => setEditForm((f) => ({ ...f, key_value: e.target.value }))}
                      className={`mt-1 ${inputCls}`}
                      placeholder="Pozostaw puste, aby nie zmieniać"
                      data-testid={`account-key-edit-value-${key.id}`}
                    />
                  </div>
                  {editError && (
                    <p className="text-sm text-red-600" data-testid={`account-key-edit-error-${key.id}`}>
                      {editError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(key.id)}
                      disabled={editLoading}
                      className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      data-testid={`account-key-edit-save-${key.id}`}
                    >
                      {editLoading ? 'Zapisuję...' : 'Zapisz'}
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditError(null); }}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
                      data-testid={`account-key-edit-cancel-${key.id}`}
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" data-testid={`account-key-label-${key.id}`}>
                        {key.label}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {key.provider}
                      </span>
                      {key.is_active && (
                        <span
                          className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          data-testid={`account-key-active-badge-${key.id}`}
                        >
                          aktywny
                        </span>
                      )}
                      {key.last_test_result === 'ok' && (
                        <span className="text-xs text-green-600 dark:text-green-400" data-testid={`account-key-test-ok-${key.id}`}>
                          ✓ OK
                        </span>
                      )}
                      {key.last_test_result === 'error' && (
                        <span className="text-xs text-red-600 dark:text-red-400" data-testid={`account-key-test-error-${key.id}`}>
                          ✗ błąd
                        </span>
                      )}
                    </div>
                    {key.model && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{key.model}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => openEdit(key)}
                      className="rounded border border-gray-300 px-3 py-1 text-xs dark:border-gray-600"
                      data-testid={`account-key-edit-btn-${key.id}`}
                    >
                      Edytuj
                    </button>
                    <button
                      onClick={() => handleTestKey(key.id)}
                      disabled={testingId === key.id}
                      className="rounded border border-gray-300 px-3 py-1 text-xs disabled:opacity-50 dark:border-gray-600"
                      data-testid={`account-key-test-btn-${key.id}`}
                    >
                      {testingId === key.id ? '...' : 'Testuj'}
                    </button>
                    {!key.is_active && (
                      <button
                        onClick={() => handleActivateKey(key.id)}
                        disabled={activatingId === key.id}
                        className="rounded border border-blue-400 px-3 py-1 text-xs text-blue-600 disabled:opacity-50 dark:border-blue-500 dark:text-blue-400"
                        data-testid={`account-key-activate-btn-${key.id}`}
                      >
                        {activatingId === key.id ? '...' : 'Aktywuj'}
                      </button>
                    )}
                    {key.is_active && (
                      <button
                        onClick={() => handleDeactivateKey(key.id)}
                        disabled={deactivatingId === key.id}
                        className="rounded border border-orange-300 px-3 py-1 text-xs text-orange-600 disabled:opacity-50 dark:border-orange-600 dark:text-orange-400"
                        data-testid={`account-key-deactivate-btn-${key.id}`}
                      >
                        {deactivatingId === key.id ? '...' : 'Deaktywuj'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteKey(key.id)}
                      disabled={deletingId === key.id}
                      className="rounded border border-red-300 px-3 py-1 text-xs text-red-600 disabled:opacity-50 dark:border-red-700 dark:text-red-400"
                      data-testid={`account-key-delete-btn-${key.id}`}
                    >
                      {deletingId === key.id ? '...' : 'Usuń'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
