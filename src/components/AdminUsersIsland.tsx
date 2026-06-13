import { useEffect, useMemo, useState } from 'react';

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

const PAGE_SIZE = 20;

function isAutomatic(user: UserAdminDTO): boolean {
  return user.is_technical;
}

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
  const [togglingTechnicalId, setTogglingTechnicalId] = useState<string | null>(null);
  const [loadingImpersonateId, setLoadingImpersonateId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [hideAutomatic, setHideAutomatic] = useState(true);
  const [hideDeleted, setHideDeleted] = useState(true);
  const [page, setPage] = useState(1);

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

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, hideAutomatic, hideDeleted]);

  const filteredUsers = useMemo(() => {
    if (state.status !== 'ok') return [];
    let result = state.users;

    if (hideDeleted) {
      result = result.filter((u) => u.deleted_at === null);
    }

    if (hideAutomatic) {
      result = result.filter((u) => !isAutomatic(u));
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (u) =>
          u.email.toLowerCase().includes(q) || (u.display_name ?? '').toLowerCase().includes(q),
      );
    }

    return result;
  }, [state, search, hideAutomatic, hideDeleted]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageUsers = filteredUsers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const automaticCount = state.status === 'ok' ? state.users.filter(isAutomatic).length : 0;
  const deletedCount =
    state.status === 'ok' ? state.users.filter((u) => u.deleted_at !== null).length : 0;
  const totalCount = state.status === 'ok' ? state.users.length : 0;

  async function handleToggleTechnical(user: UserAdminDTO) {
    if (togglingTechnicalId) return;
    setTogglingTechnicalId(user.id);

    setState((prev) => {
      if (prev.status !== 'ok') return prev;
      return {
        status: 'ok',
        users: prev.users.map((u) =>
          u.id === user.id ? { ...u, is_technical: !u.is_technical } : u,
        ),
      };
    });

    try {
      const res = await fetch(`/api/admin/users/${user.id}/technical`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_technical: !user.is_technical }),
      });
      if (!res.ok) {
        setState((prev) => {
          if (prev.status !== 'ok') return prev;
          return {
            status: 'ok',
            users: prev.users.map((u) =>
              u.id === user.id ? { ...u, is_technical: user.is_technical } : u,
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
            u.id === user.id ? { ...u, is_technical: user.is_technical } : u,
          ),
        };
      });
    } finally {
      setTogglingTechnicalId(null);
    }
  }

  async function handleToggleAi(user: UserAdminDTO) {
    if (togglingId) return;
    setTogglingId(user.id);

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

        const hash = new URL(body.data.action_link).hash.substring(1);
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token') ?? '';
        const refresh_token = params.get('refresh_token') ?? '';
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
          window.location.href = '/shelves';
          return;
        }
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

  const firstItem = filteredUsers.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(safePage * PAGE_SIZE, filteredUsers.length);

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
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Szukaj po emailu lub nazwie…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="admin-users-search"
            className="w-64 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hideAutomatic}
              onChange={(e) => setHideAutomatic(e.target.checked)}
              data-testid="admin-users-hide-automatic"
              className="h-4 w-4 cursor-pointer accent-indigo-600"
            />
            Ukryj konta automatyczne
            {automaticCount > 0 && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                {automaticCount}
              </span>
            )}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hideDeleted}
              onChange={(e) => setHideDeleted(e.target.checked)}
              data-testid="admin-users-hide-deleted"
              className="h-4 w-4 cursor-pointer accent-indigo-600"
            />
            Ukryj usunięte
            {deletedCount > 0 && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                {deletedCount}
              </span>
            )}
          </label>
        </div>

        {/* Counter */}
        <p
          className="mb-3 text-sm text-gray-500 dark:text-gray-400"
          data-testid="admin-users-counter"
        >
          {filteredUsers.length === 0 ? (
            'Brak wyników.'
          ) : (
            <>
              Wyświetlono{' '}
              <strong>
                {firstItem}–{lastItem}
              </strong>{' '}
              z <strong>{filteredUsers.length}</strong>
              {(hideAutomatic && automaticCount > 0) || (hideDeleted && deletedCount > 0) ? (
                <span className="ml-1 text-gray-400">
                  (łącznie {totalCount}
                  {hideAutomatic && automaticCount > 0 && `, ukryto ${automaticCount} auto`}
                  {hideDeleted && deletedCount > 0 && `, ukryto ${deletedCount} usuniętych`})
                </span>
              ) : null}
            </>
          )}
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
                <th className="px-4 py-2 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Tech
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
              {pageUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-6 text-center text-gray-400 dark:text-gray-500"
                    data-testid="admin-users-empty"
                  >
                    Brak użytkowników spełniających kryteria.
                  </td>
                </tr>
              ) : (
                pageUsers.map((user) => {
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
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Tech dla ${user.email}`}
                          data-testid={`admin-user-technical-toggle-${user.id}`}
                          checked={user.is_technical}
                          disabled={!!user.deleted_at || togglingTechnicalId === user.id}
                          onChange={() => handleToggleTechnical(user)}
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
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            className="mt-3 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400"
            data-testid="admin-users-pagination"
          >
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              data-testid="admin-users-prev"
              className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              ← Poprzednia
            </button>
            <span data-testid="admin-users-page-info">
              Strona {safePage} z {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              data-testid="admin-users-next"
              className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              Następna →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
