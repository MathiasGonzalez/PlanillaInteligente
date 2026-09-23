import { useState, type JSX } from 'react';

interface Card { id: string; title: string; status: string; }

interface Props {
  appId: string;
  entityKey: string;
  statusField: string;
  statuses: string[];
  cards: Card[];
}

export default function KanbanBoard({ appId, entityKey, statusField, statuses, cards }: Props): JSX.Element {
  const [items, setItems] = useState(cards);
  const columns = statuses.length > 0 ? statuses : [...new Set(items.map((card) => card.status).filter(Boolean))];

  async function move(id: string, status: string) {
    const previous = items;
    setItems((current) => current.map((card) => card.id === id ? { ...card, status } : card));
    const response = await fetch(`/api/apps/${appId}/records/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { [statusField]: status } }),
    });
    if (!response.ok) setItems(previous);
  }

  return (
    <div className="kanban">
      {columns.map((status) => (
        <section
          key={status}
          className="card"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const id = event.dataTransfer.getData('text/plain');
            if (id) void move(id, status);
          }}
        >
          <h2>{status || 'Sin estado'}</h2>
          {items.filter((card) => card.status === status).map((card) => (
            <a
              key={card.id}
              href={`/apps/${appId}/${entityKey}/${card.id}`}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
            >
              {card.title}
            </a>
          ))}
        </section>
      ))}
      <style>{`.kanban{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:0.75rem}.kanban a{display:block;margin-top:0.5rem;padding:0.6rem;border:1px solid var(--line);border-radius:10px;text-decoration:none}`}</style>
    </div>
  );
}
