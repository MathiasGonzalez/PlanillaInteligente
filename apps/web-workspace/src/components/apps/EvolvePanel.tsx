import { useEffect, useState, type JSX } from 'react';
import { jsonFetch } from '../../lib/json-fetch';

interface Proposal {
  id: string;
  instruction: string;
  status: string;
  preview: { diff?: Array<{ detail: string }>; affected?: number; failures?: string[]; explanation?: string } | null;
  errorMessage: string | null;
  baseVersion: number;
}

export default function EvolvePanel({ appId }: { appId: string }): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const { data } = await jsonFetch<{ proposals?: Proposal[] }>(`/api/apps/${appId}/proposals`);
    setProposals(data?.proposals ?? []);
  }

  useEffect(() => { void reload(); }, [appId]);

  async function propose() {
    setError(null);
    const { ok, data } = await jsonFetch<{ explanation?: string; error?: string }>(`/api/apps/${appId}/proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction }),
    });
    if (!ok) setError(data?.explanation ?? data?.error ?? 'No se pudo proponer el cambio.');
    setInstruction('');
    await reload();
  }

  async function act(proposalId: string, action: 'apply' | 'revert') {
    setError(null);
    const { ok, data } = await jsonFetch<{ error?: string }>(`/api/apps/${appId}/proposals/${proposalId}/${action}`, { method: 'POST' });
    if (!ok) {
      setError(data?.error ?? (action === 'apply' ? 'No se pudo aplicar el cambio.' : 'No se pudo revertir el cambio.'));
      return;
    }
    await reload();
  }

  return (
    <div className="evolve">
      <label>
        Instrucción
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Agregá un campo de notas, o extraé pagos parciales" />
      </label>
      <button className="cta" type="button" onClick={() => void propose()}>Proponer cambio</button>
      {error ? <p className="alert">{error}</p> : null}
      <ul>
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <strong>{proposal.instruction}</strong>
            <span>{proposal.status}</span>
            {proposal.errorMessage ? <p>{proposal.errorMessage}</p> : null}
            <ul>{(proposal.preview?.diff ?? []).map((line) => <li key={line.detail}>{line.detail}</li>)}</ul>
            {proposal.preview?.affected ? <p>{proposal.preview.affected} filas afectadas</p> : null}
            {(proposal.preview?.failures ?? []).map((failure) => <p key={failure}>{failure}</p>)}
            {proposal.status === 'pending' ? <button className="button-secondary" type="button" onClick={() => void act(proposal.id, 'apply')}>Aplicar</button> : null}
            {proposal.status === 'applied' ? <button className="button-secondary" type="button" onClick={() => void act(proposal.id, 'revert')}>Revertir datos</button> : null}
          </li>
        ))}
      </ul>
      <style>{`.evolve{display:grid;gap:0.75rem}textarea{min-height:5rem}li{margin:0.6rem 0}`}</style>
    </div>
  );
}
