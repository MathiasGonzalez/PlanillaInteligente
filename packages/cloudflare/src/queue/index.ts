type QueueBinding<T> = {
  send(message: T): Promise<void>;
};

export async function sendEnrichmentJob<T>(
  queue: QueueBinding<T> | undefined,
  message: T,
): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.send(message);
    return true;
  } catch {
    return false;
  }
}
