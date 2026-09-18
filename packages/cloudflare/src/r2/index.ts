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
