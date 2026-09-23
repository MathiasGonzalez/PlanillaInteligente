import { useEffect, useState, type JSX } from 'react';
import type { FieldSpec } from '@planilla/apps/spec';

interface Props {
  appId: string;
  entityKey: string;
  recordId?: string;
  fields: FieldSpec[];
  initial: Record<string, string>;
}

interface RelationOption {
  id: string;
  label: string;
}

function RelationPicker({
  appId,
  entityKey,
  value,
  required,
  onChange,
}: {
  appId: string;
  entityKey: string;
  value: string;
  required: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<RelationOption[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await fetch(`/api/apps/${appId}/records?entity=${encodeURIComponent(entityKey)}&options=1&q=${encodeURIComponent(query)}`);
        const payload = await response.json().catch(() => null) as { options?: RelationOption[] } | null;
        setOptions(payload?.options ?? []);
      })();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [appId, entityKey, query]);

  const selectedMissing = value && !options.some((option) => option.id === value);

  return (
    <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar registro" />
      <select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        <option value="">Elegir</option>
        {selectedMissing ? <option value={value}>{value}</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </>
  );
}

export default function RecordForm({ appId, entityKey, recordId, fields, initial }: Props): JSX.Element {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editable = fields.filter((field) => field.editable && field.visible && !field.sensitive && !field.specialCategory && field.type !== 'computed');

  async function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch(recordId ? `/api/apps/${appId}/records/${recordId}` : `/api/apps/${appId}/records`, {
      method: recordId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityKey, data: values }),
    });
    const payload = await response.json().catch(() => null) as { id?: string; error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(payload?.error ?? 'No se pudo guardar.');
      return;
    }
    window.location.href = `/apps/${appId}/${entityKey}/${recordId ?? payload?.id ?? ''}`;
  }

  return (
    <form className="record-form" onSubmit={onSubmit}>
      {editable.map((field) => (
        <label key={field.key}>
          {field.label}{field.required ? ' *' : ''}
          {field.type === 'long-text' ? (
            <textarea value={values[field.key] ?? ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} required={field.required} />
          ) : field.type === 'boolean' ? (
            <input type="checkbox" checked={values[field.key] === 'true'} onChange={(event) => setValues({ ...values, [field.key]: event.target.checked ? 'true' : 'false' })} />
          ) : field.options && field.options.length > 0 ? (
            <select value={values[field.key] ?? ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} required={field.required}>
              <option value="">Elegir</option>
              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : field.type === 'relation' && field.relation?.toEntity ? (
            <RelationPicker
              appId={appId}
              entityKey={field.relation.toEntity}
              value={values[field.key] ?? ''}
              required={field.required}
              onChange={(value) => setValues({ ...values, [field.key]: value })}
            />
          ) : (
            <input
              type={field.type === 'date' ? 'date' : field.type === 'number' || field.type === 'amount' ? 'number' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
              step={field.type === 'amount' ? '0.01' : undefined}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              required={field.required}
            />
          )}
          {field.currency ? <small>{field.currency}</small> : null}
        </label>
      ))}
      {error ? <p className="alert">{error}</p> : null}
      <button className="cta" type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</button>
      <style>{`.record-form{display:grid;gap:0.75rem}label{display:grid;gap:0.3rem;font-family:var(--sans);font-size:0.9rem}input,textarea,select{font:inherit;border:1px solid var(--line);border-radius:10px;padding:0.55rem 0.7rem}`}</style>
    </form>
  );
}
