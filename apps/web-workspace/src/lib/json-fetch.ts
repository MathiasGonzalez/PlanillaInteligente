export async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => null) as T | null;
  return { ok: response.ok, status: response.status, data };
}
