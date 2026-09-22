export interface LoginCodePayload {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface MailerBinding {
  sendLoginCode(payload: LoginCodePayload): Promise<{ messageId: string | null }>;
}

export async function sendLoginCode(binding: MailerBinding | undefined, payload: LoginCodePayload) {
  if (!binding) return false;
  try {
    const result = await binding.sendLoginCode(payload);
    return Boolean(result?.messageId);
  } catch {
    console.error(JSON.stringify({ event: 'login_code_failed' }));
    return false;
  }
}
