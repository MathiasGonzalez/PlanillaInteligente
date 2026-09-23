import { useEffect, useState, type JSX } from 'react';

export function EmailLogin({
  token,
  onResetChallenge,
}: {
  token: string | null;
  onResetChallenge: () => void;
}): JSX.Element {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function start(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!token) {
      setError('Confirmá el captcha antes de continuar.');
      return;
    }
    setPending(true);
    setError(null);
    const body = new FormData();
    body.set('email', email);
    body.set('cf-turnstile-response', token);
    const response = await fetch('/api/auth/email/start', { method: 'POST', body });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    setPending(false);
    onResetChallenge();
    if (!response.ok) {
      setError(payload?.error ?? 'No se pudo enviar el código. El correo no está disponible en este entorno.');
      return;
    }
    setStep('code');
    setWait(60);
  }

  async function verify(event: { preventDefault(): void }) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const body = new FormData();
    body.set('email', email);
    body.set('code', code);
    const response = await fetch('/api/auth/email/verify', { method: 'POST', body });
    setPending(false);
    if (!response.ok) {
      setError('Código incorrecto.');
      return;
    }
    window.location.href = '/';
  }

  if (step === 'code') {
    return (
      <form className="login-form email-login" onSubmit={verify}>
        <label>
          Código enviado a {email}
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            pattern="\d{6}"
            placeholder="6 dígitos"
          />
        </label>
        {error ? <p className="alert">{error}</p> : null}
        <button className="cta" type="submit" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
        <button
          className="button-secondary"
          type="button"
          disabled={wait > 0}
          onClick={() => setStep('email')}
        >
          {wait > 0 ? `Reenviar en ${wait}s` : 'Cambiar email o reenviar'}
        </button>
      </form>
    );
  }

  return (
    <>
      <p className="login-divider" aria-hidden="true">o</p>
      <form className="login-form email-login" onSubmit={start}>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            placeholder="tu@correo.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {error ? <p className="alert">{error}</p> : null}
        <button className="cta" type="submit" disabled={pending}>{pending ? 'Enviando…' : 'Continuar con email'}</button>
      </form>
    </>
  );
}
