import { useEffect, useState, type JSX } from 'react';
import type { AppSpec } from '@planilla/apps/spec';

interface Props { appId: string; }

export default function SetupWizard({ appId }: Props): JSX.Element {
  const [spec, setSpec] = useState<AppSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch(`/api/apps/${appId}/spec`).then(async (response) => {
      const payload = await response.json() as { spec?: AppSpec; error?: string };
      if (!response.ok || !payload.spec) setError(payload.error ?? 'Todavía se está analizando la planilla.');
      else setSpec(payload.spec);
    });
  }, [appId]);

  if (!spec) return <p className="muted">{error ?? 'Leyendo la planilla…'}</p>;
  const entity = spec.entities[step];

  async function save(publish: boolean) {
    setPending(true);
    const saved = await fetch(`/api/apps/${appId}/spec`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    });
    if (!saved.ok) {
      setError('No se pudo guardar.');
      setPending(false);
      return;
    }
    if (publish) {
      const published = await fetch(`/api/apps/${appId}/publish`, { method: 'POST' });
      const payload = await published.json().catch(() => null) as { unmatched?: string[] } | null;
      if (!published.ok) {
        setError('No se pudo publicar.');
        setPending(false);
        return;
      }
      if (payload?.unmatched && payload.unmatched.length > 0) {
        window.alert(`Quedaron sin vínculo: ${payload.unmatched.join(', ')}`);
      }
      window.location.href = `/apps/${appId}`;
      return;
    }
    setPending(false);
    setStep((current) => current + 1);
  }

  if (!entity) {
    return (
      <div className="wizard">
        <h2>Relaciones y resumen</h2>
        <label>Nombre de la app<input value={spec.title} onChange={(event) => setSpec({ ...spec, title: event.target.value })} /></label>
        <label>Para qué sirve<textarea value={spec.summary} onChange={(event) => setSpec({ ...spec, summary: event.target.value })} /></label>
        <ul>
          {spec.relations.map((relation) => (
            <li key={`${relation.fromEntity}-${relation.fieldKey}`}>
              {relation.fromEntity}.{relation.fieldKey} → {relation.toEntity}
              <button type="button" className="button-secondary" onClick={() => setSpec({ ...spec, relations: spec.relations.filter((item) => item !== relation) })}>Quitar</button>
            </li>
          ))}
        </ul>
        <h3>Dashboard</h3>
        {(spec.dashboards[0]?.widgets ?? []).map((widget) => (
          <label key={widget.key}>
            <input type="checkbox" checked onChange={() => setSpec({
              ...spec,
              dashboards: spec.dashboards.map((dashboard, index) => index === 0 ? { ...dashboard, widgets: dashboard.widgets.filter((item) => item.key !== widget.key) } : dashboard),
            })} />
            {widget.title}
          </label>
        ))}
        {error ? <p className="alert">{error}</p> : null}
        <button className="cta" type="button" disabled={pending} onClick={() => void save(true)}>Publicar app</button>
      </div>
    );
  }

  return (
    <div className="wizard">
      <p className="eyebrow">Lista {step + 1} de {spec.entities.length}</p>
      <label>Qué es esta lista<input value={entity.name} onChange={(event) => {
        const entities = spec.entities.map((item) => item.key === entity.key ? { ...item, name: event.target.value } : item);
        setSpec({ ...spec, entities });
      }} /></label>
      <label>Qué columna identifica la fila
        <select value={entity.primaryFieldKey ?? ''} onChange={(event) => {
          const entities = spec.entities.map((item) => item.key === entity.key ? { ...item, primaryFieldKey: event.target.value } : item);
          setSpec({ ...spec, entities });
        }}>
          {entity.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
      </label>
      <label>Columna de estado
        <select value={entity.statusFieldKey ?? ''} onChange={(event) => {
          const entities = spec.entities.map((item) => item.key === entity.key ? { ...item, statusFieldKey: event.target.value || null } : item);
          setSpec({ ...spec, entities });
        }}>
          <option value="">Ninguna</option>
          {entity.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>Columnas ocultas</legend>
        {entity.fields.filter((field) => !field.sensitive && !field.specialCategory).map((field) => (
          <label key={field.key}>
            <input type="checkbox" checked={!field.visible} onChange={(event) => {
              const entities = spec.entities.map((item) => item.key === entity.key ? {
                ...item,
                fields: item.fields.map((entry) => entry.key === field.key ? { ...entry, visible: !event.target.checked } : entry),
              } : item);
              setSpec({ ...spec, entities });
            }} />
            {field.label}
          </label>
        ))}
      </fieldset>
      {error ? <p className="alert">{error}</p> : null}
      <button className="cta" type="button" disabled={pending} onClick={() => void save(false)}>Seguir</button>
      <style>{`.wizard{display:grid;gap:0.75rem}label{display:grid;gap:0.3rem;font-family:var(--sans)}`}</style>
    </div>
  );
}
