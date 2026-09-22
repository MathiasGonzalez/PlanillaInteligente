import { useState, type JSX } from 'react';

interface UploadFormProps {
  siteKey: string;
}

export function UploadForm({ siteKey }: UploadFormProps): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: { preventDefault(): void; currentTarget: HTMLFormElement }) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json().catch(() => null)) as { appId?: string; error?: string } | null;

      if (!response.ok || !payload?.appId) {
        setError(payload?.error ?? 'No se pudo subir la planilla.');
        return;
      }

      window.location.href = `/apps/${payload.appId}/setup`;
    } catch {
      setError('No se pudo subir la planilla.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="upload-form" encType="multipart/form-data">
      <label className="upload-label">
        Archivo .xlsx
        <input type="file" name="file" accept=".xlsx" required />
      </label>
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" />
      {error ? <p className="upload-error">{error}</p> : null}
      <button className="cta" type="submit" disabled={pending}>
        {pending ? 'Subiendo…' : 'Subir planilla'}
      </button>
    </form>
  );
}
