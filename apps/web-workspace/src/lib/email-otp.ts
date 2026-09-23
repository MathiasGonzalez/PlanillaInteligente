function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function hmacHex(encodedKey: string, message: string) {
  const raw = base64ToBytes(encodedKey);
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

export function randomOtp() {
  const range = 1_000_000;
  const max = Math.floor(0x1_0000_0000 / range) * range;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] ?? 0;
  } while (value >= max);
  return String(value % range).padStart(6, '0');
}

export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(bytes).replace(/[^a-zA-Z0-9]/g, '').slice(0, 22);
}
