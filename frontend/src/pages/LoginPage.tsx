import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockKeyhole, Mail } from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage } from '../api';
import { btnPrimary, ErrorBox, inputCls, PasswordInput } from '../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const loggedIn = await login(email, password);
      navigate(loggedIn.permissions.includes('dashboard.view') ? '/' : '/my-leave', {
        replace: true,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-600 text-xl font-black text-white">
            V
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">vula-erp</h1>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Business management
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error ? <ErrorBox message={error} /> : null}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Email
            </span>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className={`${inputCls} pl-9`}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Password
            </span>
            <PasswordInput
              leftIcon={<LockKeyhole className="size-4 text-slate-400" />}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
