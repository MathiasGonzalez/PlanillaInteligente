import { LogIn } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { EmailLogin } from './EmailLogin';

interface TurnstileApi {
  render(element: HTMLElement, options: {
    sitekey: string;
    theme: 'light';
    callback: (token: string) => void;
    'expired-callback': () => void;
  }): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

interface LoginCardProps {
  action?: string;
  siteKey: string;
  title?: string;
  description?: string;
  error?: string;
}

export function LoginCard({
  action = '/api/auth/signin/google',
  siteKey,
  title = 'Accede a tu workspace',
  description = 'Entrá con Google o con un código que te llega al email.',
  error,
}: LoginCardProps): JSX.Element {
  const slot = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mount = () => {
      const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      const node = slot.current;
      if (cancelled || !turnstile || !node || widgetId.current) return;
      widgetId.current = turnstile.render(node, {
        sitekey: siteKey,
        theme: 'light',
        callback: (next) => setToken(next),
        'expired-callback': () => setToken(null),
      });
    };
    mount();
    const timer = window.setInterval(mount, 200);
    const stop = window.setTimeout(() => window.clearInterval(timer), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(stop);
      const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (widgetId.current && turnstile) turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  function resetChallenge() {
    setToken(null);
    const turnstile = (window as Window & { turnstile?: TurnstileApi }).turnstile;
    if (widgetId.current && turnstile) turnstile.reset(widgetId.current);
  }

  function onGoogleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!token) {
      event.preventDefault();
      setLocalError('Confirmá el captcha antes de continuar.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'cf-turnstile-response';
    input.value = token;
    event.currentTarget.append(input);
  }

  return (
    <section className="card login-card" aria-label="Inicio de sesión">
      <div className="login-copy">
        <p className="eyebrow">PlanillaInteligente</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>

      <div ref={slot} className="turnstile-slot" />
      {error || localError ? <p className="alert login-alert">{error ?? localError}</p> : null}

      <form method="post" action={action} className="login-form" onSubmit={onGoogleSubmit}>
        <button type="submit" className="cta">
          <LogIn size={16} aria-hidden="true" />
          Continuar con Google
        </button>
      </form>
      <EmailLogin token={token} onResetChallenge={resetChallenge} />
    </section>
  );
}
