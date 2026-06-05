import { useState } from 'react';

/**
 * React island: signup form. Hydratuje się `client:load` (auth flow jest
 * above-the-fold krytyczny, nie odkładamy hydracji do widoczności).
 *
 * Submit: fetch JSON POST do /api/auth/signup → success: window.location.href
 * = data.redirect. Cookie set'owany przez @supabase/ssr po stronie serwera
 * (signUp helper); następny request (po redirect) middleware odczytuje cookie
 * i populuje locals.user.
 *
 * Error UX: VALIDATION_ERROR z details.fieldErrors → per-field error; inne
 * (401, 500, etc.) → top-level formError.
 */

type FieldErrors = Record<string, string[]>;

type ApiSuccess = { data: { redirect: string } };
type ApiFailure = {
  error: {
    code: string;
    message: string;
    details?: { fieldErrors?: FieldErrors; formErrors?: string[] };
  };
};

export default function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors | null>(null);

  // React 19: FormEvent / FormEventHandler oznaczone deprecated; pomijamy
  // jawną adnotację typu, TS infer'uje z onSubmit prop'a na <form>.
  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    setFieldErrors(null);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
        }),
      });
      const json = (await res.json()) as ApiSuccess | ApiFailure;

      if (res.ok && 'data' in json) {
        window.location.href = json.data.redirect;
        return;
      }

      const failure = json as ApiFailure;
      if (failure.error?.code === 'VALIDATION_ERROR' && failure.error.details?.fieldErrors) {
        setFieldErrors(failure.error.details.fieldErrors);
      } else {
        setFormError(failure.error?.message ?? 'Signup failed.');
      }
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="signup-form">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        {fieldErrors?.email?.[0] && (
          <p className="mt-1 text-sm text-red-600" data-testid="error-email">
            {fieldErrors.email[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="display_name" className="block text-sm font-medium">
          Nazwa wyświetlana
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          autoComplete="name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        {fieldErrors?.display_name?.[0] && (
          <p className="mt-1 text-sm text-red-600" data-testid="error-display-name">
            {fieldErrors.display_name[0]}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Hasło
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        {fieldErrors?.password?.[0] && (
          <p className="mt-1 text-sm text-red-600" data-testid="error-password">
            {fieldErrors.password[0]}
          </p>
        )}
      </div>

      {formError && (
        <p className="text-sm text-red-600" data-testid="form-error">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        data-testid="submit-signup"
      >
        {loading ? 'Rejestruję...' : 'Zarejestruj się'}
      </button>
    </form>
  );
}
