export async function getKvJson<T>(kv: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!kv) return null;
  return kv.get<T>(key, 'json');
}

export async function putKvJson(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  if (!kv) return;
  await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
}

export async function deleteKv(kv: KVNamespace | undefined, key: string): Promise<void> {
  if (!kv) return;
  await kv.delete(key);
}
