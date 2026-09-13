import { LogIn } from 'lucide-react';
import type { JSX } from 'react';

interface LoginCardProps {
  action?: string;
  siteKey: string;
  title?: string;
  description?: string;
  error?: string;
}

const baseCardClassName =
  'w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-950';
const buttonClassName =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200';

export function LoginCard({
  action = '/api/auth/signin/google',
  siteKey,
  title = 'Accede a tu workspace',
  description = 'Inicia sesión con Google para crear o seleccionar tu organización multi-tenant.',
  error,
}: LoginCardProps): JSX.Element {
  return (
    <section className={baseCardClassName} aria-label="Inicio de sesión">
      <div className="space-y-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600">PlanillaInteligente</p>
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">{title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>
      </div>

      <form method="post" action={action} className="mt-6 space-y-4">
        <div
          className="cf-turnstile flex min-h-16 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
          data-sitekey={siteKey}
          data-theme="auto"
        />

        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <button type="submit" className={buttonClassName}>
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Continuar con Google
        </button>
      </form>
    </section>
  );
}
