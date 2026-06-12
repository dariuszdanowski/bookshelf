import { useEffect, useState } from 'react';

import type { UserAdminDTO } from '../pages/api/admin/users/index';
import Skeleton from './Skeleton';

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

export default function AdminUsersIsland() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
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
        // Revert optimistic update on error
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
      // Revert on network error
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {users.map((user) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
