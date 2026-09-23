export async function putObject(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream,
  options?: { contentType?: string },
) {
  return bucket.put(key, data, {
    httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
  });
}

export async function getObject(bucket: R2Bucket, key: string) {
  return bucket.get(key);
}

export async function deleteObject(bucket: R2Bucket, key: string) {
  return bucket.delete(key);
}

export async function deleteObjectsByPrefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;

  do {
    const listed = await bucket.list({ prefix, cursor });
    await Promise.all(listed.objects.map((object) => bucket.delete(object.key)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
