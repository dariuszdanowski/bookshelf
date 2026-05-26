import { useState } from 'react';

/**
 * Pojedynczy button POST do /api/auth/logout. Idempotent z perspektywy UX:
 * niezależnie od response cookies są scleared przez @supabase/ssr, więc
 * po reloadzie user wraca na anon state na `/login`.
 */
export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Idempotent: nawet przy network blip i tak redirectujemy.
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="rounded border px-3 py-1 text-sm disabled:opacity-50"
      data-testid="logout-button"
    >
      {loading ? 'Wylogowuję...' : 'Wyloguj'}
    </button>
  );
}
