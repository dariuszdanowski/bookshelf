import { useState } from 'react';

/**
 * React island: login form. Analog SignupForm, bez display_name. Endpoint:
 * /api/auth/login. Generic error message "Invalid email or password" przy
 * bad credentials (privacy — server tak zwraca, client wyświetla bez zmian).
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

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors | null>(null);

  // React 19: FormEvent / FormEventHandler oznaczone deprecated; używamy
  // SyntheticEvent (nadal supported, base type) zamiast aliasów.
  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    setFieldErrors(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
        setFormError(failure.error?.message ?? 'Login failed.');
      }
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
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
          className="mt-1 block w-full rounded border px-3 py-2"
        />
        {fieldErrors?.email?.[0] && (
          <p className="mt-1 text-sm text-red-600" data-testid="error-email">
            {fieldErrors.email[0]}
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded border px-3 py-2"
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
        data-testid="submit-login"
      >
        {loading ? 'Loguję...' : 'Zaloguj się'}
      </button>
    </form>
  );
}
