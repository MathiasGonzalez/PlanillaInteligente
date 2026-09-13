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

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    return {
      success: false,
      errorCodes: [`http-${response.status}`],
    };
  }

  const payload = (await response.json()) as CloudflareTurnstileResponse;

  return {
    success: payload.success,
    challengeTs: payload.challenge_ts,
    hostname: payload.hostname,
    action: payload.action,
    cdata: payload.cdata,
    errorCodes: payload['error-codes'] ?? [],
  };
}
