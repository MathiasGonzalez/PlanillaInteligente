export interface LoginCodePayload {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface MailerEnv {
  EMAIL_SEND_URL?: string;
  EMAIL_API_KEY?: string;
  ANALYSIS_MODE?: string;
}

const DEFAULT_SEND_URL = 'https://send.cfemailer.com/send';

export async function sendLoginCode(env: MailerEnv, payload: LoginCodePayload) {
  if (env.ANALYSIS_MODE === 'inline') {
    console.log(`login OTP: ${payload.code}`);
    return true;
  }

  const url = env.EMAIL_SEND_URL?.trim() || DEFAULT_SEND_URL;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const apiKey = env.EMAIL_API_KEY?.trim();
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: payload.to,
        kind: 'login-code',
        code: payload.code,
        expiresInMinutes: payload.expiresInMinutes,
      }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: 'login_code_failed', status: response.status }));
      return false;
    }
    return true;
  } catch {
    console.error(JSON.stringify({ event: 'login_code_failed' }));
    return false;
  }
}
