export interface TurnstileVerificationResult {
  success: boolean;
  challengeTs?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  errorCodes: string[];
}

interface CloudflareTurnstileResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  'error-codes'?: string[];
}

interface VerifyTurnstileOptions {
  token: string;
  secretKey: string;
  remoteIp?: string;
  idempotencyKey?: string;
}

const TURNSTILE_TIMEOUT_MS = 10_000;

export async function verifyTurnstileToken({
  token,
  secretKey,
  remoteIp,
  idempotencyKey,
}: VerifyTurnstileOptions): Promise<TurnstileVerificationResult> {
  if (!token || !secretKey) {
    return {
      success: false,
      errorCodes: ['missing-input'],
    };
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  if (idempotencyKey) {
    body.set('idempotency_key', idempotencyKey);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    return {
      success: false,
      errorCodes: [error instanceof DOMException && error.name === 'AbortError' ? 'request-timeout' : 'network-error'],
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return {
      success: false,
      errorCodes: [`http-${response.status}`],
    };
  }

  let payload: CloudflareTurnstileResponse;
  try {
    payload = (await response.json()) as CloudflareTurnstileResponse;
  } catch {
    return {
      success: false,
      errorCodes: ['invalid-json-response'],
    };
  }

  return {
    success: payload.success,
    challengeTs: payload.challenge_ts,
    hostname: payload.hostname,
    action: payload.action,
    cdata: payload.cdata,
    errorCodes: payload['error-codes'] ?? [],
  };
}
