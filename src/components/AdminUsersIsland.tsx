import { useEffect, useState } from 'react';

import { createBrowserSupabaseClient } from '../lib/db/supabase.browser';
import type { UserAdminDTO } from '../pages/api/admin/users/index';
import ConfirmDialog from './ConfirmDialog';
import Skeleton from './Skeleton';

type Props = {
  currentUserId: string;
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; users: UserAdminDTO[] };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export default function AdminUsersIsland({ currentUserId }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loadingImpersonateId, setLoadingImpersonateId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function loadUsers() {
    setState({ status: 'loading' });
    fetch('/api/admin/users')
      .then(
        (res) =>
          res.json() as Promise<{ data?: { users: UserAdminDTO[] }; error?: { message: string } }>,
      )
      .then((body) => {
        if (body.data) {
          setState({ status: 'ok', users: body.data.users });
        } else {
          setState({ status: 'error', message: body.error?.message ?? 'Nieznany błąd.' });
        }
      })
      .catch(() => setState({ status: 'error', message: 'Nie udało się połączyć z serwerem.' }));
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleToggleAi(user: UserAdminDTO) {
    if (togglingId) return;
    setTogglingId(user.id);

    // Optimistic update
    setState((prev) => {
      if (prev.status !== 'ok') return prev;
      return {
        status: 'ok',
        users: prev.users.map((u) => (u.id === user.id ? { ...u, ai_enabled: !u.ai_enabled } : u)),
      };
    });

    try {
      const res = await fetch(`/api/admin/users/${user.id}/ai-enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_enabled: !user.ai_enabled }),
      });
      if (!res.ok) {
        setState((prev) => {
          if (prev.status !== 'ok') return prev;
          return {
            status: 'ok',
            users: prev.users.map((u) =>
              u.id === user.id ? { ...u, ai_enabled: user.ai_enabled } : u,
            ),
          };
        });
      }
    } catch {
      setState((prev) => {
        if (prev.status !== 'ok') return prev;
        return {
          status: 'ok',
          users: prev.users.map((u) =>
            u.id === user.id ? { ...u, ai_enabled: user.ai_enabled } : u,
          ),
        };
      });
    } finally {
      setTogglingId(null);
    }
  }

  async function handleImpersonate(user: UserAdminDTO) {
    if (loadingImpersonateId) return;
    setLoadingImpersonateId(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/impersonate`, { method: 'POST' });
      const body = (await res.json()) as {
        data?: { action_link: string; email_otp: string; email: string };
        error?: { message: string };
      };
      if (body.data?.action_link) {
        const supabase = createBrowserSupabaseClient();

        // Zapisujemy sesję admina do localStorage — baner ImpersonationBanner
        // użyje jej do przywrócenia konta po zakończeniu impersonacji.
        const {
          data: { session: adminSession },
        } = await supabase.auth.getSession();
        if (adminSession) {
          localStorage.setItem(
            '__bookshelf_impersonation',
            JSON.stringify({
              admin_access_token: adminSession.access_token,
              admin_refresh_token: adminSession.refresh_token,
              impersonated_email: user.email,
            }),
          );
        }

        // Próba 1: action_link jest hash URL-em z tokenami (Supabase cloud)
        const hash = new URL(body.data.action_link).hash.substring(1);
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token') ?? '';
        const refresh_token = params.get('refresh_token') ?? '';
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
          window.location.href = '/shelves';
          return;
        }
        // Próba 2: action_link to URL serwera auth (lokalny Supabase / PKCE)
        // verifyOtp używa surowego OTP i ustawia cookies przez @supabase/ssr
        if (body.data.email_otp && body.data.email) {
          const { error } = await supabase.auth.verifyOtp({
            email: body.data.email,
            token: body.data.email_otp,
            type: 'magiclink',
          });
          if (!error) {
            window.location.href = '/shelves';
            return;
          }
        }
        // Fallback ostateczny: bezpośrednia nawigacja na action_link
        window.location.href = body.data.action_link;
      } else {
        alert(body.error?.message ?? 'Nie udało się wygenerować linku impersonacji.');
      }
    } catch {
      alert('Błąd połączenia z serwerem.');
    } finally {
      setLoadingImpersonateId(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}/delete`, { method: 'POST' });
      const body = (await res.json()) as {
        data?: { deleted: boolean };
        error?: { message: string };
      };
      if (body.data?.deleted) {
        loadUsers();
      } else {
        alert(body.error?.message ?? 'Nie udało się usunąć konta.');
      }
    } catch {
      alert('Błąd połączenia z serwerem.');
    } finally {
      setDeletingId(null);
    }
  }

  const confirmDeleteUser =
    state.status === 'ok' ? state.users.find((u) => u.id === confirmDeleteId) : null;

  if (state.status === 'loading') {
    return (
      <div className="space-y-2" data-testid="admin-users-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" aria-label="Ładowanie listy użytkowników" />
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <p className="text-red-600 dark:text-red-400" data-testid="admin-users-error">
        Błąd: {state.message}
      </p>
    );
  }

  const { users } = state;

  return (
    <>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Usuń konto użytkownika"
        message={
          confirmDeleteUser
            ? `Czy na pewno chcesz usunąć konto ${confirmDeleteUser.email}? Operacja jest nieodwracalna.`
            : 'Czy na pewno chcesz usunąć to konto?'
        }
        confirmLabel="Usuń konto"
        confirmTone="danger"
        testIdPrefix="admin-delete-dialog"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <div data-testid="admin-users-island">
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Łącznie użytkowników: <strong>{users.length}</strong>
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">
                  Email
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">
                  Nazwa
                </th>
                <th className="px-4 py-2 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Rola
                </th>
                <th className="px-4 py-2 text-center font-semibold text-gray-700 dark:text-gray-300">
                  AI
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">
                  Książki
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">
                  Półki
                </th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">
                  Data rejestracji
                </th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700 dark:text-gray-300">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {users.map((user) => {
                const isOwn = user.id === currentUserId;
                const isActionable = !isOwn && !user.is_admin && !user.deleted_at;
                return (
                  <tr
                    key={user.id}
                    data-testid={`admin-user-row-${user.id}`}
                    className={`bg-white dark:bg-gray-900 ${user.deleted_at ? 'opacity-50' : ''}`}
                  >
                    <td className="max-w-[200px] truncate px-4 py-2 text-gray-900 dark:text-gray-100">
                      <span title={user.email}>{user.email}</span>
                      {user.deleted_at && (
                        <span
                          className="ml-2 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          data-testid={`admin-user-deleted-badge-${user.id}`}
                        >
                          Usunięte
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                      {user.display_name ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {user.is_admin && (
                        <span className="inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                          Admin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`AI dla ${user.email}`}
                        data-testid={`admin-user-ai-toggle-${user.id}`}
                        checked={user.ai_enabled}
                        disabled={!!user.deleted_at || togglingId === user.id}
                        onChange={() => handleToggleAi(user)}
                        className="h-4 w-4 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                      {user.book_count}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                      {user.shelf_count}
                    </td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isActionable && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            data-testid={`admin-user-impersonate-${user.id}`}
                            disabled={loadingImpersonateId === user.id}
                            onClick={() => handleImpersonate(user)}
                            className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400"
                          >
                            {loadingImpersonateId === user.id ? '…' : 'Impersonuj'}
                          </button>
                          <button
                            type="button"
                            data-testid={`admin-user-delete-${user.id}`}
                            disabled={deletingId === user.id}
                            onClick={() => setConfirmDeleteId(user.id)}
                            className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400"
                          >
                            {deletingId === user.id ? '…' : 'Usuń konto'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
