import { Upload } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

const STEPS = [
  'Subiendo el archivo',
  'Leyendo las hojas',
  'Consultando el modelo',
] as const;

export function UploadForm(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [pending]);

  async function onSubmit(event: { preventDefault(): void; currentTarget: HTMLFormElement }) {
    event.preventDefault();
    setError(null);
    setStep(0);
    setPending(true);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json().catch(() => null)) as { appId?: string; error?: string } | null;

      if (!response.ok || !payload?.appId) {
        setError(payload?.error ?? 'No se pudo subir la planilla.');
        setPending(false);
        return;
      }

      window.location.href = `/apps/${payload.appId}/setup`;
    } catch {
      setError('No se pudo subir la planilla.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="upload-form" encType="multipart/form-data">
      <label className="upload-drop" style={pending ? { pointerEvents: 'none', opacity: 0.7 } : undefined}>
        <span className="upload-mark" aria-hidden="true">
          <Upload size={18} strokeWidth={2.25} />
        </span>
        <span className="upload-drop-copy">
          <span className="upload-drop-title">{filename ?? 'Elegí un archivo .xlsx'}</span>
          <span className="upload-drop-hint">{filename ? 'Listo para subir' : 'Click para buscarlo en tu computadora'}</span>
        </span>
        <input
          type="file"
          name="file"
          accept=".xlsx"
          required
          disabled={pending}
          onChange={(event) => setFilename(event.currentTarget.files?.[0]?.name ?? null)}
        />
      </label>
      {error ? <p className="alert">{error}</p> : null}
      {pending ? (
        <div className="upload-status" role="status" aria-live="polite">
          <div className="upload-track" aria-hidden="true"><span /></div>
          <ol className="upload-steps">
            {STEPS.map((label, index) => (
              <li key={label} className={index < step ? 'done' : index === step ? 'active' : undefined}>
                <span className="step-dot" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ol>
          {step === STEPS.length - 1 ? (
            <p className="upload-note">El modelo mira la estructura. Los valores de las celdas no se envían.</p>
          ) : null}
        </div>
      ) : (
        <button className="cta" type="submit">Subir planilla</button>
      )}
      <style>{`
        .upload-form { display: grid; gap: 0.9rem; justify-items: start; margin-top: 1rem; }
        .upload-drop {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.85rem;
          width: 100%;
          box-sizing: border-box;
          border: 1.5px dashed color-mix(in srgb, var(--accent) 42%, var(--line));
          border-radius: 14px;
          padding: 1rem 1.05rem;
          background: color-mix(in srgb, var(--accent-soft) 62%, white);
          cursor: pointer;
        }
        .upload-drop:hover { border-color: var(--accent); background: var(--accent-soft); }
        .upload-drop:focus-within { outline: 2px solid var(--ink); outline-offset: 3px; }
        .upload-drop input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }
        .upload-mark {
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          width: 2.25rem;
          height: 2.25rem;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: white;
          color: var(--accent);
        }
        .upload-drop-copy { display: grid; gap: 0.15rem; min-width: 0; }
        .upload-drop-title, .upload-drop-hint { font-family: var(--sans); }
        .upload-drop-title {
          font-size: 0.95rem;
          font-weight: 650;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .upload-drop-hint { color: var(--muted); font-size: 0.82rem; }
        .upload-status {
          width: 100%;
          box-sizing: border-box;
          display: grid;
          gap: 0.75rem;
          padding: 0.9rem 1rem 1rem;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: white;
        }
        .upload-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
        .upload-steps li {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          font-family: var(--sans);
          font-size: 0.875rem;
          color: var(--muted);
        }
        .upload-steps li.done { color: var(--accent); }
        .upload-steps li.active { color: var(--ink); font-weight: 650; }
        .step-dot {
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          background: var(--line);
          flex: 0 0 auto;
        }
        .upload-steps li.done .step-dot { background: var(--accent); }
        .upload-steps li.active .step-dot { background: var(--accent); }
        .upload-note {
          margin: 0;
          font-family: var(--sans);
          font-size: 0.8rem;
          line-height: 1.45;
          color: var(--muted);
        }
        @media (prefers-reduced-motion: no-preference) {
          .upload-steps li.active .step-dot { animation: step-pulse 1.2s ease-out infinite; }
        }
        @keyframes step-pulse {
          0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); }
          70% { box-shadow: 0 0 0 7px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </form>
  );
}
