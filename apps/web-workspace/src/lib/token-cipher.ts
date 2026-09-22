const KEY_VERSION = 'v1';
const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importKey(encodedKey: string) {
  const raw = base64ToBytes(encodedKey);
  if (raw.byteLength !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes.');
  }

  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** `v1:<base64 iv>:<base64 ciphertext>`. The version prefix allows a later key rotation. */
export async function encryptSecret(plaintext: string, encodedKey: string) {
  const key = await importKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  return `${KEY_VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(payload: string, encodedKey: string) {
  const [version, iv, ciphertext] = payload.split(':');
  if (version !== KEY_VERSION || !iv || !ciphertext) {
    throw new Error('Encrypted secret has an unsupported format.');
  }

  const key = await importKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}
