export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export function fail(status: number, error = 'No se pudo completar la operación.') {
  const correlationId = crypto.randomUUID();
  console.error(JSON.stringify({ event: 'api_error', correlationId, status }));
  return json({ error, correlationId }, status);
}
